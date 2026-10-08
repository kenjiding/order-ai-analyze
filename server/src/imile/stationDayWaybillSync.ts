/**
 * 站点日运单增量同步：写入 driver_map_waybill_points，供 24H 派签告警与司机地图共用。
 * 已达标 / 已超窗口的单号跳过 searchWaybill，只拉未终态子集。
 */
import { and, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { AusTz } from './ausTimezone'
import {
  fetchWaybillDetailsIncremental,
  type InboundWaybillRow,
} from './inboundWaybillIndex'
import type { Dispatch24hWaybillRow } from '../vendorAnalysis/dispatch24hAggregate'
import { normalizeZipCode } from '../vendorRegionMap/parseInbound'

function readText(row: InboundWaybillRow | Dispatch24hWaybillRow, key: string): string {
  const v = (row as Record<string, unknown>)[key]
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 拼收件地址展示文案（司机地图弹窗用）。坐标不再由这段文本地理编码得出——
 * 坐标改为按运单号从 iMile sorting/pageList 直接查（见 ../driverMap/driverMapPointsQuery.ts），
 * 这里只负责拼出人可读的地址。澳洲常见格式：
 * `详细地址, 城市, 省 邮编, Australia`
 * 例：`12 King William St, Adelaide, SA 5000, Australia`
 *
 * iMile 的 consigneeAddress 有时已含 suburb/州/邮编/Australia，此时不再重复拼接其余字段。
 */
function buildAddressText(row: InboundWaybillRow): string {
  const address =
    readText(row, 'consigneeAddress') ||
    readText(row, 'consigneeDetailedAddress') ||
    readText(row, 'consigneeAddr') ||
    readText(row, 'address')
  const city = readText(row, 'consigneeCity') || readText(row, 'city')
  const province =
    readText(row, 'consigneeProvince') || readText(row, 'province') || readText(row, 'state')
  const zipCode =
    readText(row, 'consigneeZipCode') ||
    readText(row, 'consigneePostCode') ||
    readText(row, 'zipCode')

  if (!address && !city && !province && !zipCode) return ''

  const addressLower = address.toLowerCase()
  const alreadyRich =
    /\baustralia\b/i.test(address) ||
    (Boolean(zipCode) && address.includes(zipCode)) ||
    (Boolean(city) && addressLower.includes(city.toLowerCase()))

  if (alreadyRich) {
    return /\baustralia\b/i.test(address) ? address : `${address}, Australia`
  }

  // 省与邮编紧挨（SA 5000），比用逗号分隔更易被 Geocoding 识别
  const region = [province, zipCode].filter(Boolean).join(' ')
  const parts = [address, city, region, 'Australia'].filter(Boolean)
  if (parts.length <= 1) return address
  return parts.join(', ')
}

function resolvePointStatus(signDate: string, lastProblemDate: string): 'completed' | 'problem' | 'pending' {
  if (signDate) return 'completed'
  if (lastProblemDate) return 'problem'
  return 'pending'
}

/** toCacheRow 只读这几列，用 Pick 而非整行 $inferSelect，使 upsert 前的内存行（$inferInsert）也能直接复用，无需为拿一份 Dispatch24hWaybillRow 而回读整表 */
type CacheableWaybillPoint = Pick<
  typeof schema.driverMapWaybillPoints.$inferInsert,
  | 'waybillNo'
  | 'courierName'
  | 'courierCode'
  | 'vendorCode'
  | 'clientCode'
  | 'consigneeRouteCode'
  | 'lastScanSiteCode'
  | 'stationCode'
  | 'postcode'
  | 'suburb'
  | 'deliveryTime'
  | 'signDate'
  | 'lastProblemDate'
  | 'updatedAt'
>

function toCacheRow(row: CacheableWaybillPoint): Dispatch24hWaybillRow {
  return {
    waybillNo: row.waybillNo,
    courier: row.courierName || undefined,
    courierCode: row.courierCode || undefined,
    courierVendorCode: row.vendorCode || undefined,
    clientCode: row.clientCode || undefined,
    consigneeRouteCode: row.consigneeRouteCode || undefined,
    lastScanSiteCode: row.lastScanSiteCode || row.stationCode || undefined,
    postcode: row.postcode || undefined,
    suburb: row.suburb || undefined,
    deliveryTime: row.deliveryTime ?? undefined,
    signDate: row.signDate ?? undefined,
    lastProblemDate: row.lastProblemDate ?? undefined,
    syncedAtMs: row.updatedAt?.getTime() ?? Date.now(),
  }
}

export async function loadStationDayWaybillCache(
  stationCode: string,
  dataDate: string,
): Promise<Map<string, Dispatch24hWaybillRow>> {
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
  const map = new Map<string, Dispatch24hWaybillRow>()
  for (const row of rows) map.set(row.waybillNo, toCacheRow(row))
  return map
}

export type StationDayWaybillSyncResult = {
  ok: true
  stationCode: string
  dataDate: string
  indexCount: number
  fetchedCount: number
  skippedCount: number
  upsertedCount: number
  /** 本次同步后，该站点该日的全量运单行（刚 upsert 的 + 复用未变的缓存行），供聚合直接使用，避免同步完再整表 SELECT 一次 */
  rows: Dispatch24hWaybillRow[]
}

/**
 * 把 searchWaybill 形状的明细记录写进缓存表。增量同步与「上传运单表结算」共用这一套字段映射——
 * 上传的表格先被前端转成 searchWaybill 的字段名，再从这里落缓存，后续聚合与接口拉取完全同路。
 */
export async function upsertStationDayWaybillRecords(input: {
  stationCode: string
  dataDate: string
  records: InboundWaybillRow[]
}): Promise<{
  rowsByWaybillNo: Map<string, typeof schema.driverMapWaybillPoints.$inferInsert>
  upsertedCount: number
}> {
  const { stationCode, dataDate } = input
  const db = getDb()
  const now = new Date()

  // 同批内同单号去重（保留后出现的行）：同一条 INSERT 内重复冲突键会报 "cannot affect row a second time"
  const rowsByWaybillNo = new Map<string, typeof schema.driverMapWaybillPoints.$inferInsert>()
  for (const row of input.records) {
    const waybillNo = readText(row, 'waybillNo')
    if (!waybillNo) continue
    const signDate = readText(row, 'signDate') || null
    const lastProblemDate = readText(row, 'lastProblemDate') || null
    const status = resolvePointStatus(signDate ?? '', lastProblemDate ?? '')

    rowsByWaybillNo.set(waybillNo, {
      waybillNo,
      stationCode,
      vendorCode: readText(row, 'courierVendorCode'),
      courierCode: readText(row, 'courierCode'),
      courierName: readText(row, 'courier'),
      clientCode: readText(row, 'clientCode'),
      dataDate,
      deliveryTime: readText(row, 'deliveryTime') || null,
      signDate,
      lastProblemDate,
      problemReason:
        readText(row, 'problemReason') ||
        readText(row, 'problemReasonDesc') ||
        readText(row, 'lastProblemReason') ||
        '',
      consigneeRouteCode: readText(row, 'consigneeRouteCode'),
      lastScanSiteCode: readText(row, 'lastScanSiteCode') || stationCode,
      status,
      // iMile 的 consigneeCity 装的就是澳洲 suburb；与 postcode 一起用于匹配区域包裹价格
      postcode: normalizeZipCode(readText(row, 'consigneeZipCode')),
      suburb: readText(row, 'consigneeCity'),
      addressText: buildAddressText(row),
      latitude: null,
      longitude: null,
      geocodedAt: null,
      updatedAt: now,
    })
  }

  // 分块批量 upsert，替代逐行「SELECT + UPSERT」（上万单 = 数万次串行 DB 往返，拖慢整个阶段）。
  // 地址没变则保留已解析坐标，变了置空待重新 geocode——原逐行逻辑用 SQL CASE 就地表达。
  const p = schema.driverMapWaybillPoints
  const toUpsert = [...rowsByWaybillNo.values()]
  const upsertedCount = toUpsert.length
  for (let i = 0; i < toUpsert.length; i += 500) {
    await db
      .insert(p)
      .values(toUpsert.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [p.waybillNo, p.dataDate],
        set: {
          stationCode: sql`excluded.station_code`,
          vendorCode: sql`excluded.vendor_code`,
          courierCode: sql`excluded.courier_code`,
          courierName: sql`excluded.courier_name`,
          clientCode: sql`excluded.client_code`,
          deliveryTime: sql`excluded.delivery_time`,
          signDate: sql`excluded.sign_date`,
          lastProblemDate: sql`excluded.last_problem_date`,
          problemReason: sql`excluded.problem_reason`,
          consigneeRouteCode: sql`excluded.consignee_route_code`,
          lastScanSiteCode: sql`excluded.last_scan_site_code`,
          status: sql`excluded.status`,
          postcode: sql`excluded.postcode`,
          suburb: sql`excluded.suburb`,
          latitude: sql`CASE WHEN ${p.addressText} = excluded.address_text THEN ${p.latitude} ELSE NULL END`,
          longitude: sql`CASE WHEN ${p.addressText} = excluded.address_text THEN ${p.longitude} ELSE NULL END`,
          geocodedAt: sql`CASE WHEN ${p.addressText} = excluded.address_text THEN ${p.geocodedAt} ELSE NULL END`,
          addressText: sql`excluded.address_text`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
  }

  return { rowsByWaybillNo, upsertedCount }
}

/**
 * 增量同步某站点某日运单到缓存表。仅更新本次新拉到的明细；终态单保留原行。
 * 不负责地理编码（司机地图刷新在此之后单独 geocode）。
 */
export async function syncStationDayWaybillsIncremental(input: {
  token: string
  stationCode: string
  dataDate: string
  tz: AusTz
  label: string
  /** 见 fetchWaybillDetailsIncremental.forceIndexRefresh：结算类调用必须传 true */
  forceIndexRefresh?: boolean
  /** 见 fetchWaybillDetailsIncremental.forceDetailRefresh：要求字段完整的结算类调用必须传 true */
  forceDetailRefresh?: boolean
  /** 见 fetchWaybillDetailsIncremental.skipDetailFetch */
  skipDetailFetch?: boolean
}): Promise<StationDayWaybillSyncResult | { ok: false; message: string }> {
  const { token, stationCode, dataDate, tz, label, forceIndexRefresh, forceDetailRefresh, skipDetailFetch } = input
  const cachedByWaybillNo = await loadStationDayWaybillCache(stationCode, dataDate)

  const fetched = await fetchWaybillDetailsIncremental({
    token,
    stationCode,
    dateStr: dataDate,
    label,
    tz,
    cachedByWaybillNo,
    forceIndexRefresh,
    forceDetailRefresh,
    skipDetailFetch,
  })
  if (!fetched.ok) return { ok: false, message: fetched.message }

  const { rowsByWaybillNo, upsertedCount } = await upsertStationDayWaybillRecords({
    stationCode,
    dataDate,
    records: fetched.fetchedRecords,
  })

  console.log(
    `[waybill-sync] ${label} station=${stationCode} date=${dataDate} index=${fetched.waybillNos.length} fetched=${fetched.fetchedCount} skipped=${fetched.skippedCount} upserted=${upsertedCount}`,
  )

  // 合并本次 upsert 的新行 + 未变动、复用旧值的缓存行，拼出与「同步后整表 SELECT」等价的全量结果——
  // 这两部分数据本次调用里都已经在内存中，不需要为拿全量行再回读一次数据库。
  const rows: Dispatch24hWaybillRow[] = []
  for (const waybillNo of fetched.waybillNos) {
    const upserted = rowsByWaybillNo.get(waybillNo)
    if (upserted) {
      rows.push(toCacheRow(upserted))
      continue
    }
    const cached = cachedByWaybillNo.get(waybillNo)
    if (cached) rows.push(cached)
  }

  return {
    ok: true,
    stationCode,
    dataDate,
    indexCount: fetched.waybillNos.length,
    fetchedCount: fetched.fetchedCount,
    skippedCount: fetched.skippedCount,
    upsertedCount,
    rows,
  }
}
