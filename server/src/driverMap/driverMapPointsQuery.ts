/**
 * 司机地图：从站点日运单缓存读已签收/问题件点位；刷新走与 24H 派签告警相同的增量同步，再补地理编码。
 */
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { AUS_TZ, iMileStrToMs } from '../imile/ausTimezone'
import { syncStationDayWaybillsIncremental } from '../imile/stationDayWaybillSync'
import { fetchSearchWaybillByNos } from '../imile/inboundWaybillIndex'
import { envFirst } from '../imile/shared'

/** 全站刷新时限制新 API 调用；供应商门户按 vendor 范围不套此上限 */
const GEOCODE_API_CALLS_PER_STATION_REFRESH = 800
/** 门户按供应商补坐标时的并发（单供应商通常 1k 级唯一地址） */
const GEOCODE_VENDOR_CONCURRENCY = 8

/** 服务端地理编码优先用 SERVER key；未配置时回退 BROWSER key（本地常只配了一个） */
function readGoogleMapsGeocodeKey(): string {
  return envFirst('GOOGLE_MAPS_SERVER_API_KEY') ?? envFirst('GOOGLE_MAPS_BROWSER_API_KEY') ?? ''
}

export type DriverMapPointDto = {
  waybillNo: string
  status: 'completed' | 'problem' | 'pending'
  lat: number
  lng: number
  time: string
  address: string
  /** 问题件原因（仅 status=problem 时有意义） */
  problemReason?: string
}

export type DriverMapDriverDto = {
  courierCode: string
  courierName: string
  points: DriverMapPointDto[]
  currentPosition: { lat: number; lng: number } | null
}

export type DriverMapPointsResult = {
  dataDate: string
  stationCode: string
  drivers: DriverMapDriverDto[]
  totalCount: number
  geocodedCount: number
  pendingCount: number
  completedCount: number
  problemCount: number
}

export type DriverMapPointsQueryOutcome =
  | { ok: true; data: DriverMapPointsResult }
  | { ok: false; message: string }

/** 复用用户已在「24小时派签告警」页面保存过的 iMile token，不要求为司机地图单独配置一遍 */
export async function readDriverMapImileToken(): Promise<string> {
  const db = getDb()
  const rows = await db
    .select({ imileToken: schema.dispatchAlarmSchedules.imileToken })
    .from(schema.dispatchAlarmSchedules)
    .where(and(isNotNull(schema.dispatchAlarmSchedules.imileToken), ne(schema.dispatchAlarmSchedules.imileToken, '')))
    .limit(1)
  const fromSchedule = rows[0]?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_DISPATCH_ALARM_TOKEN') ?? ''
}

type GeocodeApiOutcome =
  | { kind: 'ok'; data: { latitude: number; longitude: number } }
  | { kind: 'not_found' }
  | { kind: 'retryable'; status: string }

async function geocodeAddress(addressText: string): Promise<GeocodeApiOutcome | { kind: 'error' }> {
  const apiKey = readGoogleMapsGeocodeKey()
  if (!apiKey) return { kind: 'error' }
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressText)}&key=${apiKey}`
    const resp = await fetch(url)
    const json = (await resp.json()) as {
      status?: string
      error_message?: string
      results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>
    }
    if (json.status === 'OK') {
      const loc = json.results?.[0]?.geometry?.location
      if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return { kind: 'not_found' }
      return { kind: 'ok', data: { latitude: loc.lat, longitude: loc.lng } }
    }
    if (json.status === 'ZERO_RESULTS') return { kind: 'not_found' }
    // REQUEST_DENIED / OVER_QUERY_LIMIT 等不可写入 not_found 缓存，否则修好 Key 后也不会重试
    console.warn(
      `[driver-map/geocode] status=${json.status ?? 'unknown'} msg=${json.error_message ?? ''} addr=${addressText.slice(0, 60)}`,
    )
    return { kind: 'retryable', status: json.status ?? 'unknown' }
  } catch (err) {
    console.error('[driver-map/geocode] 请求异常:', err)
    return { kind: 'error' }
  }
}

async function writeGeocodeCache(
  addressText: string,
  result: { latitude: number; longitude: number } | null,
  status: 'ok' | 'not_found',
): Promise<void> {
  const db = getDb()
  await db
    .insert(schema.geocodeCache)
    .values({
      addressText,
      latitude: result?.latitude ?? null,
      longitude: result?.longitude ?? null,
      status,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.geocodeCache.addressText,
      set: {
        latitude: result?.latitude ?? null,
        longitude: result?.longitude ?? null,
        status,
        updatedAt: new Date(),
      },
    })
}

/** 把解析到的坐标立刻写回运单点位（按地址批量），避免「全部 geocode 完才落库」导致超时后 0 点 */
async function applyGeocodeToPoints(
  stationCode: string,
  dataDate: string,
  addressText: string,
  point: { latitude: number; longitude: number },
  vendorCode?: string,
): Promise<number> {
  const db = getDb()
  const now = new Date()
  const updated = await db
    .update(schema.driverMapWaybillPoints)
    .set({
      latitude: point.latitude,
      longitude: point.longitude,
      geocodedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.driverMapWaybillPoints.stationCode, stationCode),
        eq(schema.driverMapWaybillPoints.dataDate, dataDate),
        eq(schema.driverMapWaybillPoints.addressText, addressText),
        or(isNull(schema.driverMapWaybillPoints.latitude), isNull(schema.driverMapWaybillPoints.longitude)),
        vendorCode ? eq(schema.driverMapWaybillPoints.vendorCode, vendorCode) : undefined,
      ),
    )
    .returning({ id: schema.driverMapWaybillPoints.id })
  return updated.length
}

/** 把 geocode_cache 已成功的坐标一次性灌回点位表 */
async function applyGeocodeCacheHits(stationCode: string, dataDate: string, vendorCode?: string): Promise<number> {
  const db = getDb()
  const result = await db.execute(sql`
    UPDATE driver_map_waybill_points AS p
    SET
      latitude = g.latitude,
      longitude = g.longitude,
      geocoded_at = NOW(),
      updated_at = NOW()
    FROM geocode_cache AS g
    WHERE g.address_text = p.address_text
      AND g.status = 'ok'
      AND g.latitude IS NOT NULL
      AND g.longitude IS NOT NULL
      AND p.station_code = ${stationCode}
      AND p.data_date = ${dataDate}
      AND p.status IN ('completed', 'problem', 'pending')
      AND p.address_text <> ''
      AND (p.latitude IS NULL OR p.longitude IS NULL)
      ${vendorCode ? sql`AND p.vendor_code = ${vendorCode}` : sql``}
  `)
  return Number((result as { rowCount?: number }).rowCount ?? 0)
}

async function mapPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor
      cursor += 1
      await worker(items[idx]!)
    }
  })
  await Promise.all(runners)
}

/**
 * 为尚无坐标的签收/问题件补地理编码（地址已由 consignee* 字段拼好）。
 * - 先批量落 geocodeCache 命中
 * - 未命中再调 Google；传 vendorCode 时只处理该供应商（门户用）
 */
export async function geocodePendingMapPoints(input: {
  stationCode: string
  dataDate: string
  vendorCode?: string
  /** 未传 vendorCode 时生效，防止全站一次打爆 */
  maxApiCalls?: number
  concurrency?: number
}): Promise<number> {
  const { stationCode, dataDate, vendorCode } = input
  const maxApiCalls = vendorCode ? Number.POSITIVE_INFINITY : (input.maxApiCalls ?? GEOCODE_API_CALLS_PER_STATION_REFRESH)
  const concurrency = input.concurrency ?? (vendorCode ? GEOCODE_VENDOR_CONCURRENCY : 1)

  const db = getDb()
  const apiKey = readGoogleMapsGeocodeKey()
  if (!apiKey) {
    console.warn('[driver-map/geocode] 未配置 GOOGLE_MAPS_SERVER_API_KEY / GOOGLE_MAPS_BROWSER_API_KEY，跳过地理编码')
    return 0
  }

  let updated = await applyGeocodeCacheHits(stationCode, dataDate, vendorCode)

  const rows = await db
    .select({ addressText: schema.driverMapWaybillPoints.addressText })
    .from(schema.driverMapWaybillPoints)
    .where(
      and(
        eq(schema.driverMapWaybillPoints.stationCode, stationCode),
        eq(schema.driverMapWaybillPoints.dataDate, dataDate),
        inArray(schema.driverMapWaybillPoints.status, ['completed', 'problem', 'pending']),
        ne(schema.driverMapWaybillPoints.addressText, ''),
        or(isNull(schema.driverMapWaybillPoints.latitude), isNull(schema.driverMapWaybillPoints.longitude)),
        vendorCode ? eq(schema.driverMapWaybillPoints.vendorCode, vendorCode) : undefined,
      ),
    )

  if (rows.length === 0) {
    console.info(
      `[driver-map/geocode] station=${stationCode} date=${dataDate} vendor=${vendorCode ?? '*'} cacheApplied=${updated} unique=0 apiCalls=0`,
    )
    return updated
  }

  const uniqueAddresses = [...new Set(rows.map((r) => r.addressText).filter(Boolean))]
  const needApi: string[] = []
  for (const addressText of uniqueAddresses) {
    const cached = await db
      .select()
      .from(schema.geocodeCache)
      .where(eq(schema.geocodeCache.addressText, addressText))
      .limit(1)
    if (cached.length > 0) {
      const c = cached[0]!
      if (c.status === 'ok' && c.latitude != null && c.longitude != null) {
        updated += await applyGeocodeToPoints(stationCode, dataDate, addressText, {
          latitude: c.latitude,
          longitude: c.longitude,
        }, vendorCode)
      }
      continue
    }
    needApi.push(addressText)
  }

  const toCall = needApi.slice(0, Number.isFinite(maxApiCalls) ? maxApiCalls : needApi.length)
  let apiCalls = 0
  let stopApi = false

  await mapPool(toCall, concurrency, async (addressText) => {
    if (stopApi) return
    const geocoded = await geocodeAddress(addressText)
    apiCalls += 1
    if (geocoded.kind === 'ok') {
      await writeGeocodeCache(addressText, geocoded.data, 'ok')
      updated += await applyGeocodeToPoints(stationCode, dataDate, addressText, geocoded.data, vendorCode)
    } else if (geocoded.kind === 'not_found') {
      await writeGeocodeCache(addressText, null, 'not_found')
    } else if (geocoded.kind === 'retryable' && (geocoded.status === 'REQUEST_DENIED' || geocoded.status === 'OVER_QUERY_LIMIT')) {
      console.warn(`[driver-map/geocode] 中止本轮 API 调用 status=${geocoded.status}`)
      stopApi = true
    }
  })

  console.info(
    `[driver-map/geocode] station=${stationCode} date=${dataDate} vendor=${vendorCode ?? '*'} unique=${uniqueAddresses.length} needApi=${needApi.length} apiCalls=${apiCalls} updatedRows=${updated}`,
  )
  return updated
}

function buildDriversFromRows(
  rows: Array<typeof schema.driverMapWaybillPoints.$inferSelect>,
  vendorCode?: string,
): {
  drivers: DriverMapDriverDto[]
  totalCount: number
  geocodedCount: number
  pendingCount: number
  completedCount: number
  problemCount: number
} {
  const scoped = rows.filter((r) => !vendorCode || r.vendorCode === vendorCode)
  const completedCount = scoped.filter((r) => r.status === 'completed').length
  const problemCount = scoped.filter((r) => r.status === 'problem').length
  const pendingCount = scoped.filter((r) => r.status === 'pending').length
  const plottable = scoped.filter(
    (r) => r.status === 'completed' || r.status === 'problem' || r.status === 'pending',
  )

  const byDriver = new Map<string, { courierCode: string; courierName: string; points: DriverMapPointDto[] }>()
  let geocodedCount = 0

  for (const row of plottable) {
    if (row.latitude == null || row.longitude == null) continue
    const time =
      row.status === 'completed'
        ? row.signDate
        : row.status === 'problem'
          ? row.lastProblemDate
          : row.deliveryTime || '1970-01-01 00:00:00'
    if (!time && row.status !== 'pending') continue
    geocodedCount += 1

    const key = row.courierCode || `unknown:${row.vendorCode}`
    if (!byDriver.has(key)) {
      byDriver.set(key, {
        courierCode: row.courierCode,
        courierName: row.courierName || row.courierCode,
        points: [],
      })
    }
    byDriver.get(key)!.points.push({
      waybillNo: row.waybillNo,
      status: row.status as 'completed' | 'problem' | 'pending',
      lat: row.latitude,
      lng: row.longitude,
      time,
      address: row.addressText,
      problemReason: row.status === 'problem' ? row.problemReason || undefined : undefined,
    })
  }

  const drivers = [...byDriver.values()].map((d) => {
    const points = [...d.points].sort((a, b) => iMileStrToMs(a.time) - iMileStrToMs(b.time))
    // 当前位置取最近一单「已签收/问题件」，未签收不参与定位近似
    const terminal = points.filter((p) => p.status !== 'pending')
    const trail = terminal.length > 0 ? terminal : points
    return {
      courierCode: d.courierCode,
      courierName: d.courierName,
      points,
      currentPosition: trail.length > 0 ? { lat: trail[trail.length - 1]!.lat, lng: trail[trail.length - 1]!.lng } : null,
    }
  })

  return {
    drivers,
    totalCount: completedCount + problemCount,
    geocodedCount,
    pendingCount,
    completedCount,
    problemCount,
  }
}

/** 从缓存表组装地图点位（不触发 iMile 拉取） */
export async function queryDriverMapPoints(input: {
  stationCode: string
  dataDate: string
  vendorCode?: string
}): Promise<DriverMapPointsQueryOutcome> {
  const { stationCode, dataDate, vendorCode } = input
  const db = getDb()
  const rows = await db
    .select()
    .from(schema.driverMapWaybillPoints)
    .where(
      and(
        eq(schema.driverMapWaybillPoints.stationCode, stationCode),
        eq(schema.driverMapWaybillPoints.dataDate, dataDate),
      ),
    )

  const built = buildDriversFromRows(rows, vendorCode)
  return {
    ok: true,
    data: {
      dataDate,
      stationCode,
      drivers: built.drivers,
      totalCount: built.totalCount,
      geocodedCount: built.geocodedCount,
      pendingCount: built.pendingCount,
      completedCount: built.completedCount,
      problemCount: built.problemCount,
    },
  }
}

export type DriverMapRefreshResult = {
  dataDate: string
  stationCode: string
  indexCount: number
  fetchedCount: number
  skippedCount: number
  geocodedUpdated: number
  points: DriverMapPointsResult
}

/**
 * 为缺 reason 的问题件补 problemReason（门户打开时按供应商范围拉取，避免历史缓存永远空白）。
 */
export async function ensureProblemReasons(input: {
  stationCode: string
  dataDate: string
  vendorCode?: string
}): Promise<number> {
  const { stationCode, dataDate, vendorCode } = input
  const db = getDb()
  const token = await readDriverMapImileToken()
  if (!token) return 0

  const rows = await db
    .select({
      waybillNo: schema.driverMapWaybillPoints.waybillNo,
      id: schema.driverMapWaybillPoints.id,
    })
    .from(schema.driverMapWaybillPoints)
    .where(
      and(
        eq(schema.driverMapWaybillPoints.stationCode, stationCode),
        eq(schema.driverMapWaybillPoints.dataDate, dataDate),
        eq(schema.driverMapWaybillPoints.status, 'problem'),
        eq(schema.driverMapWaybillPoints.problemReason, ''),
        vendorCode ? eq(schema.driverMapWaybillPoints.vendorCode, vendorCode) : undefined,
      ),
    )

  if (rows.length === 0) return 0

  const fetched = await fetchSearchWaybillByNos({
    token,
    stationCode,
    dateStr: dataDate,
    waybillNos: rows.map((r) => r.waybillNo),
    label: '司机地图补问题件原因',
    tz: AUS_TZ.Adelaide,
  })
  if (!fetched.ok) {
    console.warn(`[driver-map/problem-reason] 拉取失败: ${fetched.message}`)
    return 0
  }

  const reasonByNo = new Map<string, string>()
  for (const row of fetched.records) {
    const no = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
    if (!no) continue
    const reason =
      (typeof row.problemReason === 'string' && row.problemReason.trim()) ||
      (typeof row.problemReasonDesc === 'string' && row.problemReasonDesc.trim()) ||
      (typeof row.lastProblemReason === 'string' && row.lastProblemReason.trim()) ||
      ''
    if (reason) reasonByNo.set(no, reason)
  }

  let updated = 0
  const now = new Date()
  for (const row of rows) {
    const reason = reasonByNo.get(row.waybillNo)
    if (!reason) continue
    await db
      .update(schema.driverMapWaybillPoints)
      .set({ problemReason: reason, updatedAt: now })
      .where(eq(schema.driverMapWaybillPoints.id, row.id))
    updated += 1
  }
  console.info(
    `[driver-map/problem-reason] station=${stationCode} date=${dataDate} vendor=${vendorCode ?? '*'} missing=${rows.length} updated=${updated}`,
  )
  return updated
}

/**
 * 手动增量刷新：同步未终态运单 → 为已签收/问题件补地理编码 → 返回最新点位。
 * 不做定时任务；由前端「刷新」按钮触发。
 */
export async function refreshDriverMapPoints(input: {
  stationCode: string
  dataDate: string
  vendorCode?: string
}): Promise<{ ok: true; data: DriverMapRefreshResult } | { ok: false; message: string }> {
  const { stationCode, dataDate, vendorCode } = input
  const token = await readDriverMapImileToken()
  if (!token) {
    return { ok: false, message: '未配置 iMile token，请先在「24小时派签告警」页面保存一次 token' }
  }

  const synced = await syncStationDayWaybillsIncremental({
    token,
    stationCode,
    dataDate,
    tz: AUS_TZ.Adelaide,
    label: '司机地图增量刷新',
  })
  if (!synced.ok) return synced

  await ensureProblemReasons({ stationCode, dataDate, vendorCode })
  const geocodedUpdated = await geocodePendingMapPoints({ stationCode, dataDate, vendorCode })
  const points = await queryDriverMapPoints({ stationCode, dataDate, vendorCode })
  if (!points.ok) return points

  return {
    ok: true,
    data: {
      dataDate,
      stationCode,
      indexCount: synced.indexCount,
      fetchedCount: synced.fetchedCount,
      skippedCount: synced.skippedCount,
      geocodedUpdated,
      points: points.data,
    },
  }
}
