/**
 * 路由难易度用到的「商业街密度」「公寓占比」「写字楼/商铺建筑占比」信号，数据源是 OSM
 * Overpass（免费，无 key）。按 (邮编,郊区) 的边界框查一次，结果永久缓存进
 * vendor_region_area_signals——这些信号变化很慢（新开商铺/建公寓楼是月级变化），没有 TTL，
 * 要刷新由运营手动清表重查（YAGNI）。
 *
 * 商业密度和写字楼占比看起来都是「商业」，但不是同一回事：商业密度是「周边 POI 有多密集」
 * （跟同批查询里的其他邮区比），容易被大面积边界稀释；写字楼/商铺建筑占比是「这片区域的
 * 建筑里有多大比例是商用」，是跟自己比的绝对比例，不受批次内其他邮区影响——CBD 这类
 * 实测商业密度被大边界摊薄、但建筑用途比例依然很高的区域，靠这一项才能把难度分真正拉上去。
 *
 * 用边界框（bbox）而不是精确裁剪 ABS 多边形：Overpass 的 poly 过滤器对复杂多边形更贵、
 * 还要处理 MultiPolygon 多个环，而「商业街/公寓」本来就是粗粒度的区域特征，bbox 的误差
 * （多算了邮区之外一点面积）对打分影响可以忽略，换来查询简单可靠——如果以后发现 bbox
 * 误差明显带偏某些狭长/不规则邮区的分数，再上 poly 过滤器。
 */
import { inArray } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { PostcodeGeometry } from './types'

/**
 * 官方实例 overpass-api.de 在部分网络环境下连不上（实测：TLS 连接直接被重置，DNS 能解析但
 * 握手不通，其余站点正常——像是网络层面把这个德国 IP 挡了，不是接口本身的问题）。
 * overpass.openstreetmap.fr 实测可连且数据是最新的（阿德莱德 CBD/伦敦市中心对照过，数字合理），
 * 放第一位；官方实例放第二位当兜底，换了网络环境能连的话自动就用上，不用改代码。
 */
const OVERPASS_URLS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter']
const REQUEST_TIMEOUT_MS = 25_000
/** 公共 Overpass 实例建议 ≤1 req/s，缓存未命中时串行请求，请求之间留间隔避免被限流/封禁 */
const REQUEST_GAP_MS = 1_100

export type AreaSignal = {
  zipCode: string
  suburb: string
  /** 商业 POI 密度：个/km²，查不到时为 null，不伪造 */
  commercialDensity: number | null
  /** 公寓建筑占全部建筑的比例 0-1，查不到时为 null */
  apartmentRatio: number | null
  /** 写字楼/商铺/工业用途建筑占全部建筑的比例 0-1，查不到时为 null */
  commercialBuildingRatio: number | null
}

export type AreaSignalRequest = { zipCode: string; suburb: string; geometry: PostcodeGeometry }

type Bbox = { south: number; west: number; north: number; east: number }

function geometryBbox(geometry: PostcodeGeometry): Bbox {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  return { south: minLat, west: minLng, north: maxLat, east: maxLng }
}

const KM_PER_DEG_LAT = 110.574

function bboxAreaKm2(bbox: Bbox): number {
  const midLat = (bbox.south + bbox.north) / 2
  const kmPerDegLng = 111.32 * Math.cos((midLat * Math.PI) / 180)
  return Math.max(0, bbox.north - bbox.south) * KM_PER_DEG_LAT * Math.max(0, bbox.east - bbox.west) * kmPerDegLng
}

/** 四段 out count 的顺序即结果顺序：商业 POI / 全部建筑 / 公寓建筑 / 写字楼商铺工业建筑 */
function buildOverpassQuery(bbox: Bbox): string {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `[out:json][timeout:25];
(nwr["shop"](${box});nwr["office"](${box});way["landuse"="commercial"](${box}););
out count;
way["building"](${box});
out count;
way["building"="apartments"](${box});
out count;
way["building"~"^(office|commercial|retail|industrial)$"](${box});
out count;`
}

type OverpassResponse = { elements?: Array<{ type?: string; tags?: { total?: string } }> }

type OsmCounts = {
  commercialCount: number
  buildingCount: number
  apartmentCount: number
  commercialBuildingCount: number
}

async function queryOverpassCounts(bbox: Bbox): Promise<OsmCounts | null> {
  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass 的 nginx 前端对没有自定义 User-Agent（Node fetch 默认值）的请求直接 406 拒绝，
          // 之前漏了这个头，导致每次查询都失败、信号表一直空——实测确认过，不是加个 UA 就随手猜的
          'User-Agent': 'order-ai-analyze-vendor-region-map/1.0',
        },
        body: new URLSearchParams({ data: buildOverpassQuery(bbox) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        console.warn(`[vendor-region-map] Overpass(${url}) 区域信号查询失败 HTTP ${response.status}`)
        continue
      }
      const json = (await response.json()) as OverpassResponse
      const totals = (json.elements ?? []).map((el) => Number(el.tags?.total ?? 0))
      const [commercialCount = 0, buildingCount = 0, apartmentCount = 0, commercialBuildingCount = 0] = totals
      return { commercialCount, buildingCount, apartmentCount, commercialBuildingCount }
    } catch (error) {
      console.warn(`[vendor-region-map] Overpass(${url}) 区域信号查询异常`, {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toSignal(
  zipCode: string,
  suburb: string,
  row: {
    commercialCount: number
    buildingCount: number
    apartmentCount: number
    commercialBuildingCount: number
    bboxAreaKm2: number
  },
): AreaSignal {
  return {
    zipCode,
    suburb,
    commercialDensity: row.bboxAreaKm2 > 0 ? row.commercialCount / row.bboxAreaKm2 : null,
    apartmentRatio: row.buildingCount > 0 ? row.apartmentCount / row.buildingCount : null,
    commercialBuildingRatio: row.buildingCount > 0 ? row.commercialBuildingCount / row.buildingCount : null,
  }
}

/**
 * 只读缓存，不打 Overpass——给 /aggregate 请求路径用，保证响应速度跟这个信号的查询进度无关。
 * 缺缓存的区域返回 null（由调用方当「暂时没有这个信号」处理，routeDifficulty 本来就按这个
 * 口径设计），真正的抓取交给 `backfillAreaSignalsInBackground` 在响应之外异步跑。
 */
export async function getCachedAreaSignals(areas: AreaSignalRequest[]): Promise<Map<string, AreaSignal>> {
  const result = new Map<string, AreaSignal>()
  if (areas.length === 0) return result

  const db = getDb()
  const t = schema.vendorRegionAreaSignals
  const zipCodes = [...new Set(areas.map((a) => a.zipCode))]
  const cachedRows = await db.select().from(t).where(inArray(t.zipCode, zipCodes))

  for (const row of cachedRows) {
    result.set(`${row.zipCode}\0${row.suburb}`, toSignal(row.zipCode, row.suburb, row))
  }
  return result
}

/** 进程内「正在抓取」标记：防止同一批区域还没抓完，用户刷新/换日期区间又把同一批区域塞进来重复打 Overpass */
const inFlight = new Set<string>()

/**
 * 缺缓存的区域才真正打 Overpass（串行+限速，详见模块顶部注释），不 await——调用方发完响应
 * 就不再关心这个 promise，失败的区域不缓存、下次请求再试，不编造信号也不重试风暴。
 */
export function backfillAreaSignalsInBackground(areas: AreaSignalRequest[]): void {
  void runBackfill(areas).catch((error) => {
    console.warn('[vendor-region-map] 区域信号后台回填异常', {
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

async function runBackfill(areas: AreaSignalRequest[]): Promise<void> {
  if (areas.length === 0) return

  const db = getDb()
  const t = schema.vendorRegionAreaSignals
  const zipCodes = [...new Set(areas.map((a) => a.zipCode))]
  const cachedRows = await db.select({ zipCode: t.zipCode, suburb: t.suburb }).from(t).where(inArray(t.zipCode, zipCodes))
  const cachedKeys = new Set(cachedRows.map((row) => `${row.zipCode}\0${row.suburb}`))

  const missing = areas.filter((area) => {
    const key = `${area.zipCode}\0${area.suburb}`
    return !cachedKeys.has(key) && !inFlight.has(key)
  })
  if (missing.length === 0) return

  for (const area of missing) inFlight.add(`${area.zipCode}\0${area.suburb}`)
  try {
    for (const area of missing) {
      const bbox = geometryBbox(area.geometry)
      const areaKm2 = bboxAreaKm2(bbox)
      const counts = await queryOverpassCounts(bbox)
      await sleep(REQUEST_GAP_MS)
      if (!counts) continue

      await db
        .insert(t)
        .values({
          zipCode: area.zipCode,
          suburb: area.suburb,
          commercialCount: counts.commercialCount,
          buildingCount: counts.buildingCount,
          apartmentCount: counts.apartmentCount,
          commercialBuildingCount: counts.commercialBuildingCount,
          bboxAreaKm2: areaKm2,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [t.zipCode, t.suburb],
          set: {
            commercialCount: counts.commercialCount,
            buildingCount: counts.buildingCount,
            apartmentCount: counts.apartmentCount,
            commercialBuildingCount: counts.commercialBuildingCount,
            bboxAreaKm2: areaKm2,
            updatedAt: new Date(),
          },
        })
    }
  } finally {
    for (const area of missing) inFlight.delete(`${area.zipCode}\0${area.suburb}`)
  }
}
