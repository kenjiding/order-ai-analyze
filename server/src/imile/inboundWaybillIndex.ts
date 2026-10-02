/**
 * 站点日到件 waybillNo 索引：inbound/query 预取 + DB 缓存 + 明细查询。
 *
 * 五个业务共享同一份索引（谁先跑谁去打 inbound/query，其余命中缓存）：
 * 11点前出仓告警、24小时派签告警、出仓派签达成分析、供应商数据分析、司机地图。
 * 索引之后的明细查询（原 searchWaybill，已改走 waybillDetailsDb 的数据库查询）
 * 统一走 fetchWaybillDetailsByInboundIndex。
 */

import { and, eq, lt } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import {
  buildImilePortalHeaders,
  IMILE_DC_SCAN_QUERY_PORTAL,
} from './portal'
import { envFirstOr, isRecord, normalizeImileToken } from './shared'
import { AUS_TZ, type AusTz } from './ausTimezone'
import { queryWaybillDetailsByNos } from './waybillDetailsDb'

const DEFAULT_INBOUND_URL = 'https://ds.imile.com/lm/express/ops/v1/biz/inbound/query'

export const INBOUND_INDEX_ADELAIDE_TZ = 'Australia/Adelaide'
export const INBOUND_INDEX_MELBOURNE_TZ = 'Australia/Melbourne'
/** 索引保留天数（仅 waybillNo 列表，不含运单明细） */
export const INBOUND_INDEX_RETENTION_DAYS = 14

const INBOUND_PAGE_SHOW_COUNT = 1000
const INBOUND_PAGE_DELAY_MS = 400

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

/** 按运单号查明细（原 searchWaybill），现改为直接查数据库，不再需要分批/限流 */
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

  const records = await queryWaybillDetailsByNos(input.waybillNos)
  return { ok: true, records, waybillNos: input.waybillNos }
}

/** 索引 + 明细查询；索引优先读 DB 缓存，缺失时现场 inbound 拉取并写回（不再依赖 06:00 定时任务先跑过） */
export async function fetchWaybillDetailsByInboundIndex(input: {
  token: string
  stationCode: string
  dateStr: string
  label: string
  tz?: AusTz
  /**
   * 强制重拉到件索引，忽略 DB 缓存。
   * 缓存里的索引可能是「到件日当天」被别的功能（司机地图查今天）写下的半截清单，
   * 之后永不刷新。要求分母准确的场景（出仓派签达成分析的结算）必须传 true。
   */
  forceIndexRefresh?: boolean
}): Promise<InboundWaybillFetchSuccess | InboundWaybillFetchError> {
  const indexResult = await getOrFetchInboundWaybillNos({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    label: `${input.label} 到件索引`,
    forceRefresh: input.forceIndexRefresh,
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
