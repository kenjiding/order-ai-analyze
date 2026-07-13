/**
 * 站点日到件 waybillNo 索引：inbound/query 预取 + DB 缓存 + 分批 searchWaybill。
 * 供出仓告警、供应商/司机 11 点前出仓率等场景共享。
 */

import { and, eq, lt } from 'drizzle-orm'
import { getDb, schema } from '../db'
import {
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

const DEFAULT_DS_WAYBILL_URL = 'https://ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'
const DEFAULT_INBOUND_URL = 'https://dc.imile.com/lm/express/ops/v1/biz/inbound/query'

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

export function getRegionNow(tz: AusTz = AUS_TZ.Adelaide): {
  weekday: number
  timeHHmm: string
  dateStr: string
  prevDateStr: string
  dayBeforeDateStr: string
} {
  const now = new Date()
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

/** 到件扫描 inbound/query，提取 waybillNo 列表 */
export async function fetchInboundWaybillNos(input: {
  token: string
  stationCode: string
  dateStr: string
  label?: string
}): Promise<{ ok: true; waybillNos: string[] } | InboundWaybillFetchError> {
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
}): Promise<{ ok: true; waybillNos: string[]; fromCache: boolean } | InboundWaybillFetchError> {
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
      return { ok: true, waybillNos: cached, fromCache: true }
    }
  }

  const inbound = await fetchInboundWaybillNos({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    label: input.label,
  })
  if (!inbound.ok) return inbound

  if (input.persist !== false) {
    await saveInboundWaybillIndex({
      stationCode: input.stationCode,
      dataDate: input.dateStr,
      waybillNos: inbound.waybillNos,
    })
  }

  logInboundIndexPrefetch({
    label: input.label,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    count: inbound.waybillNos.length,
    fromCache: false,
  })

  return { ok: true, waybillNos: inbound.waybillNos, fromCache: false }
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

export type IncrementalWaybillFetchSuccess = InboundWaybillFetchSuccess & {
  /** 本次实际重新 searchWaybill 的单号数 */
  fetchedCount: number
  /** 因已达标/已超窗口而跳过的单号数 */
  skippedCount: number
  fromCacheRecords: InboundWaybillRow[]
  fetchedRecords: InboundWaybillRow[]
}

/**
 * 24H 派签增量拉数：到件索引仍全量（可走 DB 缓存），searchWaybill 只拉「未终态」单号。
 * 已达标或已超过 24H/周末窗口的单复用 cachedByWaybillNo，供告警多时段推送与司机地图刷新共用。
 */
export async function fetchWaybillDetailsIncremental(input: {
  token: string
  stationCode: string
  dateStr: string
  label: string
  tz: AusTz
  cachedByWaybillNo: Map<string, Dispatch24hWaybillRow>
  nowMs?: number
}): Promise<IncrementalWaybillFetchSuccess | InboundWaybillFetchError> {
  const indexResult = await getOrFetchInboundWaybillNos({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    label: `${input.label} 到件索引`,
  })
  if (!indexResult.ok) return indexResult

  const needNos = selectWaybillNosNeedingRefresh(
    indexResult.waybillNos,
    input.cachedByWaybillNo,
    input.tz,
    input.nowMs,
  )
  const needSet = new Set(needNos)
  const fromCacheRecords: InboundWaybillRow[] = []
  for (const no of indexResult.waybillNos) {
    if (needSet.has(no)) continue
    const cached = input.cachedByWaybillNo.get(no)
    if (!cached) continue
    fromCacheRecords.push(cached as InboundWaybillRow)
  }

  const fetched = await fetchSearchWaybillByNos({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    waybillNos: needNos,
    label: input.label,
    tz: input.tz,
  })
  if (!fetched.ok) return fetched

  const byNo = new Map<string, InboundWaybillRow>()
  for (const row of fromCacheRecords) {
    const no = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
    if (no) byNo.set(no, row)
  }
  for (const row of fetched.records) {
    const no = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
    if (no) byNo.set(no, row)
  }

  const records = indexResult.waybillNos
    .map((no) => byNo.get(no))
    .filter((row): row is InboundWaybillRow => row != null)

  return {
    ok: true,
    records,
    waybillNos: indexResult.waybillNos,
    fetchedCount: needNos.length,
    skippedCount: indexResult.waybillNos.length - needNos.length,
    fromCacheRecords,
    fetchedRecords: fetched.records,
  }
}
