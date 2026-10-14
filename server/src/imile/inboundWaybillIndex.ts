/**
 * 站点日到件 waybillNo 索引：inbound/query 预取 + DB 缓存 + 分批 searchWaybill。
 *
 * 五个业务共享同一份索引（谁先跑谁去打 inbound/query，其余命中缓存）：
 * 11点前出仓告警、24小时派签告警、出仓派签达成分析、供应商数据分析、司机地图。
 * 索引之后的明细拉取分两条路：出仓侧全量重拉 searchWaybill（见 fetchWaybillDetailsByInboundIndex），
 * 派签侧走增量 + OFD 报表/签收查询/问题件明细缓存（见 fetchWaybillDetailsIncremental）——
 * 派签侧原先因 searchWaybill 被网关限流改走 Janus 智能取数单接口，但 Janus 数仓约小时级同步、
 * 推送时效跟不上，现改回 OFD 报表 + delivered/query + problem/search 三接口拼（见 ofdReport.ts）。
 */

import { and, eq, lt } from 'drizzle-orm'
import { getDb, schema } from '../db'
import {
  resolveDispatch24hWindowRule,
  selectWaybillNosNeedingRefresh,
  type Dispatch24hWaybillRow,
} from '../vendorAnalysis/dispatch24hAggregate'
import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import {
  buildImilePortalHeaders,
  IMILE_DC_SCAN_QUERY_PORTAL,
  IMILE_DS_SAAS_TMS_PORTAL,
} from './portal'
import { envFirstOr, isRecord, normalizeImileToken, sleep } from './shared'
import { AUS_TZ, type AusTz } from './ausTimezone'
import {
  fetchDeliveredByNos,
  fetchLastProblemsByNos,
  fetchOfdReportByNos,
  type DeliveredQueryRow,
  type LastProblem,
  type OfdReportRow,
} from './ofdReport'

const DEFAULT_DS_WAYBILL_URL = 'https://ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'
const DEFAULT_INBOUND_URL = 'https://ds.imile.com/lm/express/ops/v1/biz/inbound/query'

export const INBOUND_INDEX_ADELAIDE_TZ = 'Australia/Adelaide'
export const INBOUND_INDEX_MELBOURNE_TZ = 'Australia/Melbourne'
/** 索引保留天数（仅 waybillNo 列表，不含 searchWaybill 明细） */
export const INBOUND_INDEX_RETENTION_DAYS = 14

const INBOUND_PAGE_SHOW_COUNT = 1000
const INBOUND_PAGE_DELAY_MS = 400
const WAYBILL_PAGE_SHOW_COUNT = 1000
const WAYBILL_PAGE_DELAY_MS = 300
/** iMile 硬限制：查询单号不能超过 1000 条 */
export const SEARCH_WAYBILL_BATCH_SIZE = 1000
const WAYBILL_BATCH_DELAY_MS = 300

const INBOUND_QUERY_DEFAULTS = {
  isLatest: 1,
  orderScopeNew: '',
  receiveType: 'All',
  scanTypeList: ['100', '300', '2500', '600'],
  searchNoList: [] as string[],
  vehicleUuid: '',
}

export type InboundWaybillRow = {
  deliveryTime?: string | null
  consigneeRouteCode?: string | null
  receiveTime?: string | null
  waybillNo?: string | null
  courierCode?: string | null
  courierVendorCode?: string | null
  courier?: string | null
  [key: string]: unknown
}

export type InboundWaybillFetchSuccess = {
  ok: true
  records: InboundWaybillRow[]
  waybillNos: string[]
}

export type InboundWaybillFetchError = {
  ok: false
  status?: number
  message: string
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function makeInboundHeaders(token: string, stationCode: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_INBOUND',
    defaults: IMILE_DC_SCAN_QUERY_PORTAL,
    sharedEnvPrefixes: ['IMILE_TRACK'],
    injectUserCode: true,
    overrides: { hubcode: stationCode },
  })
}

function makeWaybillHeaders(token: string, stationCode: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_VENDOR_DS_WAYBILL',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_VENDOR_LONG_TAIL', 'IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
    overrides: { hubcode: stationCode },
  })
}

function extractWaybillNos(records: unknown[]): string[] {
  const nos = new Set<string>()
  for (const row of records) {
    if (!isRecord(row)) continue
    const no = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
    if (no) nos.add(no)
  }
  return [...nos]
}

export type InboundRouteInfo = { routeCode: string; clientCode: string }

/**
 * inbound/query 原始记录里的 routeCode/clientCode，按 waybillNo 建索引。
 * 24H 派签明细（OFD 报表/delivered/query/problem/search）都只对出仓/签收/报问题过的单才有数据，
 * 未出仓单的路由码只能从这里兜底（Janus 换掉后唯一还能拿到未出仓单路由码的地方）。
 */
function extractInboundRouteInfo(records: unknown[]): Map<string, InboundRouteInfo> {
  const map = new Map<string, InboundRouteInfo>()
  for (const row of records) {
    if (!isRecord(row)) continue
    const no = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
    if (!no || map.has(no)) continue
    map.set(no, {
      routeCode: typeof row.routeCode === 'string' ? row.routeCode.trim() : '',
      clientCode: typeof row.clientCode === 'string' ? row.clientCode.trim() : '',
    })
  }
  return map
}

function normalizeWaybillNos(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter((no): no is string => typeof no === 'string' && no.trim().length > 0)
}

export function tzOffsetMs(utcDate: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(utcDate)
  const g = (t: string) => {
    const v = parseInt(parts.find((p) => p.type === t)?.value ?? '0')
    return t === 'hour' && v === 24 ? 0 : v
  }
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcDate.getTime()
}

export function localToUtcMs(str: string, tz: string): number {
  const [datePart, timePart = '00:00:00'] = str.split(' ')
  const [yr, mo, dy] = datePart.split('-').map(Number)
  const [h = 0, m = 0, s = 0] = timePart.split(':').map(Number)
  const probe = Date.UTC(yr, mo - 1, dy, h, m, s)
  return probe - tzOffsetMs(new Date(probe), tz)
}

export function utcMsToLocalStr(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const g = (t: string) => (parts.find((p) => p.type === t)?.value ?? '00')
  const hour = g('hour') === '24' ? '00' : g('hour')
  return `${g('year')}-${g('month')}-${g('day')} ${hour}:${g('minute')}:${g('second')}`
}

export function getRegionNow(tz: AusTz = AUS_TZ.Adelaide, now: Date = new Date()): {
  weekday: number
  timeHHmm: string
  dateStr: string
  prevDateStr: string
  dayBeforeDateStr: string
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now)
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''

  const weekdayShort = g('weekday')
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  }
  const weekday = weekdayMap[weekdayShort] ?? 1

  const dateStr = `${g('year')}-${g('month')}-${g('day')}`
  const hour = g('hour') === '24' ? '00' : g('hour')
  const timeHHmm = `${hour}:${g('minute')}`

  const todayStartMs = localToUtcMs(`${dateStr} 00:00:00`, tz)
  const prevDateStr = utcMsToLocalStr(todayStartMs - 60_000, tz).slice(0, 10)
  const dayBeforeDateStr = utcMsToLocalStr(todayStartMs - 24 * 60 * 60 * 1000 - 60_000, tz).slice(0, 10)

  return { weekday, timeHHmm, dateStr, prevDateStr, dayBeforeDateStr }
}

export function regionDateToMelbourneRange(
  dateStr: string,
  tz: AusTz = AUS_TZ.Adelaide,
): { startTime: string; endTime: string } {
  return {
    startTime: utcMsToLocalStr(localToUtcMs(`${dateStr} 00:00:00`, tz), INBOUND_INDEX_MELBOURNE_TZ),
    endTime: utcMsToLocalStr(localToUtcMs(`${dateStr} 23:59:59`, tz), INBOUND_INDEX_MELBOURNE_TZ),
  }
}

export async function loadInboundWaybillIndex(
  stationCode: string,
  dataDate: string,
): Promise<string[] | null> {
  const db = getDb()
  const rows = await db
    .select({ waybillNos: schema.stationInboundWaybillIndex.waybillNos })
    .from(schema.stationInboundWaybillIndex)
    .where(
      and(
        eq(schema.stationInboundWaybillIndex.stationCode, stationCode),
        eq(schema.stationInboundWaybillIndex.dataDate, dataDate),
      ),
    )
    .limit(1)
  return normalizeWaybillNos(rows[0]?.waybillNos)
}

export async function saveInboundWaybillIndex(input: {
  stationCode: string
  dataDate: string
  waybillNos: string[]
}): Promise<void> {
  const db = getDb()
  const now = new Date()
  await db
    .insert(schema.stationInboundWaybillIndex)
    .values({
      stationCode: input.stationCode,
      dataDate: input.dataDate,
      waybillNos: input.waybillNos,
      waybillCount: input.waybillNos.length,
      fetchedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.stationInboundWaybillIndex.stationCode,
        schema.stationInboundWaybillIndex.dataDate,
      ],
      set: {
        waybillNos: input.waybillNos,
        waybillCount: input.waybillNos.length,
        fetchedAt: now,
        updatedAt: now,
      },
    })

  await purgeOldInboundWaybillIndex(INBOUND_INDEX_RETENTION_DAYS)
}

export async function purgeOldInboundWaybillIndex(keepDays = INBOUND_INDEX_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - keepDays)
  const cutoffDate = utcMsToLocalStr(cutoff.getTime(), INBOUND_INDEX_ADELAIDE_TZ).slice(0, 10)

  const db = getDb()
  const deleted = await db
    .delete(schema.stationInboundWaybillIndex)
    .where(lt(schema.stationInboundWaybillIndex.dataDate, cutoffDate))
    .returning({ stationCode: schema.stationInboundWaybillIndex.stationCode })

  return deleted.length
}

/** 到件扫描 inbound/query 原始记录（含 routeCode / clientCode），同一单可能多条 */
export async function fetchInboundRecords(input: {
  token: string
  stationCode: string
  dateStr: string
  label?: string
}): Promise<{ ok: true; records: unknown[] } | InboundWaybillFetchError> {
  const normalizedToken = normalizeImileToken(input.token)
  const url = envFirstOr(['IMILE_INBOUND_URL'], DEFAULT_INBOUND_URL)
  const headers = makeInboundHeaders(normalizedToken, input.stationCode)
  const label = input.label ?? '到件waybillNo索引'

  const result = await fetchPaginatedResultRows({
    label,
    pageShowCount: INBOUND_PAGE_SHOW_COUNT,
    pageDelayMs: INBOUND_PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) => ({
      ...INBOUND_QUERY_DEFAULTS,
      startTime: `${input.dateStr} 00:00:00`,
      endTime: `${input.dateStr} 23:59:59`,
      currentPage,
      showCount,
    }),
    requestPage: (body) =>
      requestImileApi({ url, method: 'POST', headers, body, label }),
  })

  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message }
  }

  return { ok: true, records: result.records }
}

/** 到件扫描 inbound/query，提取 waybillNo 列表 */
export async function fetchInboundWaybillNos(input: {
  token: string
  stationCode: string
  dateStr: string
  label?: string
}): Promise<{ ok: true; waybillNos: string[] } | InboundWaybillFetchError> {
  const result = await fetchInboundRecords(input)
  if (!result.ok) return result
  return { ok: true, waybillNos: extractWaybillNos(result.records) }
}

/**
 * 读 DB 索引；缺失时 inbound 拉取并可选写回。
 * forceRefresh=true 时忽略缓存重新拉到件。
 */
function logInboundIndexPrefetch(input: {
  label?: string
  stationCode: string
  dateStr: string
  count: number
  fromCache: boolean
}): void {
  const tag = input.label?.trim() ? ` ${input.label.trim()}` : ''
  console.log(
    `[inbound-index/pre]${tag} station=${input.stationCode} date=${input.dateStr} count=${input.count} source=${input.fromCache ? 'cache' : 'inbound/query'}`,
  )
}

export async function getOrFetchInboundWaybillNos(input: {
  token: string
  stationCode: string
  dateStr: string
  label?: string
  persist?: boolean
  forceRefresh?: boolean
}): Promise<
  | { ok: true; waybillNos: string[]; fromCache: boolean; routeInfoByNo?: Map<string, InboundRouteInfo> }
  | InboundWaybillFetchError
> {
  if (!input.forceRefresh) {
    const cached = await loadInboundWaybillIndex(input.stationCode, input.dateStr)
    // 空数组也是「有行」：曾在到件尚未入库时被写入 count=0，之后会永久短路真实 inbound。
    // 仅非空缓存视为命中；空缓存一律现场重拉（真正无到件日会多打一次 inbound，可接受）。
    if (cached && cached.length > 0) {
      logInboundIndexPrefetch({
        label: input.label,
        stationCode: input.stationCode,
        dateStr: input.dateStr,
        count: cached.length,
        fromCache: true,
      })
      // 缓存只存了 waybillNo 列表，没有 routeCode——命中缓存时拿不到未出仓单的路由码兜底。
      return { ok: true, waybillNos: cached, fromCache: true }
    }
  }

  const inbound = await fetchInboundRecords({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    label: input.label,
  })
  if (!inbound.ok) return inbound
  const waybillNos = extractWaybillNos(inbound.records)
  const routeInfoByNo = extractInboundRouteInfo(inbound.records)

  if (input.persist !== false) {
    await saveInboundWaybillIndex({
      stationCode: input.stationCode,
      dataDate: input.dateStr,
      waybillNos,
    })
  }

  logInboundIndexPrefetch({
    label: input.label,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    count: waybillNos.length,
    fromCache: false,
  })

  return { ok: true, waybillNos, fromCache: false, routeInfoByNo }
}

export async function fetchSearchWaybillByNos(input: {
  token: string
  stationCode: string
  dateStr: string
  waybillNos: string[]
  label: string
  tz?: AusTz
}): Promise<InboundWaybillFetchSuccess | InboundWaybillFetchError> {
  if (input.waybillNos.length === 0) {
    return { ok: true, records: [], waybillNos: [] }
  }

  const normalizedToken = normalizeImileToken(input.token)
  const url = envFirstOr(['IMILE_VENDOR_DS_WAYBILL_URL'], DEFAULT_DS_WAYBILL_URL)
  const headers = makeWaybillHeaders(normalizedToken, input.stationCode)
  const { startTime, endTime } = regionDateToMelbourneRange(input.dateStr, input.tz)
  const batches = chunkArray(input.waybillNos, SEARCH_WAYBILL_BATCH_SIZE)
  const allRecords: InboundWaybillRow[] = []

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]
    const result = await fetchPaginatedResultRows({
      label: input.label,
      pageShowCount: WAYBILL_PAGE_SHOW_COUNT,
      pageDelayMs: WAYBILL_PAGE_DELAY_MS,
      buildPageBody: ({ currentPage, showCount }) => ({
        actualReceiveStation: '',
        currentPage,
        dateSearchType: 'firstCountry',
        startTime,
        endTime,
        lastScanStationCode: input.stationCode,
        labelOrderCodes: [] as string[],
        mainWaybillNos: [] as string[],
        platformNos: [] as string[],
        referenceNos: [] as string[],
        showCount,
        waybillNos: batch,
      }),
      requestPage: (pageBody) =>
        requestImileApi({ url, method: 'POST', headers, body: pageBody, label: input.label }),
    })

    if (!result.ok) {
      return { ok: false, status: result.status, message: result.message }
    }

    allRecords.push(...(result.records as InboundWaybillRow[]))
    if (i < batches.length - 1) await sleep(WAYBILL_BATCH_DELAY_MS)
  }

  return { ok: true, records: allRecords, waybillNos: input.waybillNos }
}

/** 索引 + 分批 searchWaybill；索引优先读 DB 缓存，缺失时现场 inbound 拉取并写回（不再依赖 06:00 定时任务先跑过） */
export async function fetchWaybillDetailsByInboundIndex(input: {
  token: string
  stationCode: string
  dateStr: string
  label: string
  tz?: AusTz
}): Promise<InboundWaybillFetchSuccess | InboundWaybillFetchError> {
  const indexResult = await getOrFetchInboundWaybillNos({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    label: `${input.label} 到件索引`,
  })
  if (!indexResult.ok) return indexResult

  return fetchSearchWaybillByNos({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    waybillNos: indexResult.waybillNos,
    label: input.label,
    tz: input.tz,
  })
}

export type IncrementalWaybillFetchSuccess = {
  ok: true
  /** 到件索引全量单号（含本次跳过未重拉的终态单） */
  waybillNos: string[]
  /** 本次实际重新拉明细的单号数 */
  fetchedCount: number
  /** 因已达标/已超窗口而跳过的单号数 */
  skippedCount: number
  fetchedRecords: InboundWaybillRow[]
}

/**
 * 24H 派签增量拉数：到件索引仍全量（可走 DB 缓存），明细（OFD 报表 + 问题件）只拉「未终态」单号。
 * 已达标或已拿到签收时间的单复用 cachedByWaybillNo，供告警多时段推送与司机地图刷新共用。
 * 唯一调用方（stationDayWaybillSync）只消费 fetchedRecords，不需要把跳过的缓存行合并回一份
 * 全量 records 数组——大站点几万条时那份合并数组是纯粹的内存浪费，故不再构建。
 *
 * 传 forceDetailRefresh 则退化成全量重拉（见该字段注释），供结算这类要求字段完整的调用方使用。
 */
export async function fetchWaybillDetailsIncremental(input: {
  token: string
  stationCode: string
  dateStr: string
  label: string
  tz: AusTz
  cachedByWaybillNo: Map<string, Dispatch24hWaybillRow>
  /**
   * 强制重拉到件索引，忽略 DB 缓存。
   * 缓存里的索引可能是「到件日当天」被别的功能（司机地图查今天）写下的半截清单，
   * 之后永不刷新。要求分母准确的场景（出仓派签达成分析的结算）必须传 true。
   */
  forceIndexRefresh?: boolean
  /**
   * 强制重拉全部明细，忽略终态跳过。理由与 forceIndexRefresh 同源：缓存行只保证「当时关心的字段」
   * 是对的，后来新增的列（如 postcode/suburb）在旧行里是空的，而终态单永远不会被重拉，缺的列就
   * 永远补不上。要求字段完整的场景（出仓派签达成分析的结算要按收件地址查价）必须传 true。
   *
   * 注意这里**不是**放宽终态判定——isDispatch24hTerminal 仍然只看签收时间，是调用方声明
   * 「这一趟我不吃缓存」。重拉已签收的单拿回的是同一份 signDate，两个率的结论不受影响。
   */
  forceDetailRefresh?: boolean
  /**
   * 完全不拉明细，只用缓存。供「上传运单表结算」：iMile 拦截接口时，
   * 用户上传的中心运单查询表已先写进缓存（见 upsertStationDayWaybillRecords），这里不能再去拉。
   */
  skipDetailFetch?: boolean
}): Promise<IncrementalWaybillFetchSuccess | InboundWaybillFetchError> {
  const indexResult = await getOrFetchInboundWaybillNos({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    label: `${input.label} 到件索引`,
    forceRefresh: input.forceIndexRefresh,
  })
  if (!indexResult.ok) return indexResult

  // 窗口规则按「到件日」定，dateStr 就是该批次的到件日
  const needNos = input.skipDetailFetch
    ? []
    : input.forceDetailRefresh
    ? indexResult.waybillNos
    : selectWaybillNosNeedingRefresh(
        indexResult.waybillNos,
        input.cachedByWaybillNo,
        resolveDispatch24hWindowRule(input.dateStr, input.tz),
      )

  const fetched = await fetchDispatchWaybillDetailsViaReports(
    needNos,
    input.token,
    input.stationCode,
    input.label,
    indexResult.routeInfoByNo,
  )
  if (!fetched.ok) return fetched

  return {
    ok: true,
    waybillNos: indexResult.waybillNos,
    fetchedCount: needNos.length,
    skippedCount: indexResult.waybillNos.length - needNos.length,
    fetchedRecords: fetched.records,
  }
}

/**
 * 三份明细（OFD 报表/delivered/query/problem/search）+ 到件兜底路由码 → searchWaybill 同名字段的记录，
 * upsertStationDayWaybillRecords 按字段名原样读取。三份都查不到时仍返回空壳行（见下方说明），
 * signDate/lastProblemDate 为空即代表未终态，由 isDispatch24hTerminal 继续判断是否要下一轮重拉。
 */
export function buildDispatchWaybillRecord(
  waybillNo: string,
  ofd: OfdReportRow | undefined,
  delivered: DeliveredQueryRow | undefined,
  problem: LastProblem | undefined,
  routeInfo: InboundRouteInfo | undefined,
): InboundWaybillRow {
  return {
    waybillNo,
    // 派件时间只有 OFD 出仓报表有（未出仓单没有，deliveryTime 留空）
    deliveryTime: ofd?.scanTime || null,
    // 签收时间优先用 delivered/query（时效优于 OFD，OFD 的 deliveredTime 兜底）
    signDate: delivered?.deliveredDate || ofd?.deliveredTime || null,
    courierCode: ofd?.driverCode || delivered?.daCode || '',
    // delivered/query 不返回承运商编码（只有 daVendorName/vendorShortName 两个名称字段），
    // courierVendorCode 只能靠 OFD 报表；未出仓单两边都没有，留空走路由码兜底归属
    courierVendorCode: ofd?.driverVendorCode || '',
    courier: ofd?.driverName || delivered?.daName || '',
    // 未出仓单 OFD 没有路由码，依次退回 delivered/query、inbound/query 的到件记录兜底
    consigneeRouteCode: ofd?.consigneeRouteCode || delivered?.routeCode || routeInfo?.routeCode || '',
    clientCode: ofd?.clientCode || delivered?.clientCode || routeInfo?.clientCode || '',
    consigneeZipCode: ofd?.consigneeZipCode || '',
    consigneeCity: ofd?.consigneeCity || '',
    lastProblemDate: problem?.registerDate || null,
    lastScanSiteCode: problem?.lastScanStationCode || '',
    problemReason: problem?.reason || '',
  }
}

/**
 * 24H 派签明细取数（替代 Janus 单接口直查）：OFD 报表（出仓/派件时间+承运商）
 * + delivered/query（签收，时效优于 OFD/Janus）+ problem/search（问题件）三接口拼。
 * 不能只返回命中的子集——否则查不到的单会从 syncStationDayWaybillsIncremental 的
 * 全量 rows 里彻底消失，违反 selectWaybillNosNeedingRefresh 旁注明的
 * 「未派件的单也要计入 total，不能因为拿不到 deliveryTime 就当它不存在」。
 */
async function fetchDispatchWaybillDetailsViaReports(
  waybillNos: string[],
  token: string,
  stationCode: string,
  label: string,
  routeInfoByNo?: Map<string, InboundRouteInfo>,
): Promise<{ ok: true; records: InboundWaybillRow[] } | { ok: false; status: number; message: string }> {
  if (waybillNos.length === 0) return { ok: true, records: [] }

  const [ofd, delivered, problem] = await Promise.all([
    fetchOfdReportByNos({ token, stationCode, waybillNos, label: `${label} OFD报表` }),
    fetchDeliveredByNos({ token, stationCode, waybillNos, label: `${label} 签收查询` }),
    fetchLastProblemsByNos({ token, stationCode, waybillNos, label: `${label} 问题件` }),
  ])
  if (!ofd.ok) return ofd
  if (!delivered.ok) return delivered
  if (!problem.ok) return problem

  const records = waybillNos.map((no) =>
    buildDispatchWaybillRecord(
      no,
      ofd.data.get(no),
      delivered.data.get(no),
      problem.data.get(no),
      routeInfoByNo?.get(no),
    ),
  )
  return { ok: true, records }
}
