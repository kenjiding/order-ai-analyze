/**
 * 11点前出仓告警运单拉取：先到件 inbound/query 取 waybillNo，再分批 searchWaybill。
 */

import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { ExitAlarmSchedule } from '../db/schema'
import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import {
  buildImilePortalHeaders,
  IMILE_DC_SCAN_QUERY_PORTAL,
  IMILE_DS_SAAS_TMS_PORTAL,
} from './portal'
import { envFirstOr, isRecord, normalizeImileToken, sleep } from './shared'

const DEFAULT_DS_WAYBILL_URL = 'https://ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'
const DEFAULT_INBOUND_URL = 'https://dc.imile.com/lm/express/ops/v1/biz/inbound/query'

export const EXIT_ALARM_ADELAIDE_TZ = 'Australia/Adelaide'
export const EXIT_ALARM_MELBOURNE_TZ = 'Australia/Melbourne'
export const EXIT_ALARM_INBOUND_PREFETCH_TIME = '06:00'

const INBOUND_PAGE_SHOW_COUNT = 1000
const INBOUND_PAGE_DELAY_MS = 400
const WAYBILL_PAGE_SHOW_COUNT = 1000
const WAYBILL_PAGE_DELAY_MS = 300
const WAYBILL_BATCH_SIZE = 1000
const WAYBILL_BATCH_DELAY_MS = 300

const INBOUND_QUERY_DEFAULTS = {
  isLatest: 1,
  orderScopeNew: '',
  receiveType: 'All',
  scanTypeList: ['100', '300', '2500', '600'],
  searchNoList: [] as string[],
  vehicleUuid: '',
}

export type ExitAlarmWaybillRow = {
  deliveryTime?: string | null
  consigneeRouteCode?: string | null
  [key: string]: unknown
}

export type ExitAlarmWaybillFetchSuccess = {
  ok: true
  records: ExitAlarmWaybillRow[]
  waybillNos: string[]
}

export type ExitAlarmWaybillFetchError = {
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

/** 获取当前阿德莱德时间信息 */
export function getAdelaideNow(): {
  weekday: number
  timeHHmm: string
  dateStr: string
  prevDateStr: string
} {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EXIT_ALARM_ADELAIDE_TZ,
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

  const todayStartMs = localToUtcMs(`${dateStr} 00:00:00`, EXIT_ALARM_ADELAIDE_TZ)
  const prevDateStr = utcMsToLocalStr(todayStartMs - 60_000, EXIT_ALARM_ADELAIDE_TZ).slice(0, 10)

  return { weekday, timeHHmm, dateStr, prevDateStr }
}

export function adelaideDateToMelbourneRange(dateStr: string): { startTime: string; endTime: string } {
  return {
    startTime: utcMsToLocalStr(localToUtcMs(`${dateStr} 00:00:00`, EXIT_ALARM_ADELAIDE_TZ), EXIT_ALARM_MELBOURNE_TZ),
    endTime: utcMsToLocalStr(localToUtcMs(`${dateStr} 23:59:59`, EXIT_ALARM_ADELAIDE_TZ), EXIT_ALARM_MELBOURNE_TZ),
  }
}

export function readCachedInboundWaybillNos(
  schedule: Pick<ExitAlarmSchedule, 'inboundCacheDate' | 'inboundWaybillNos'>,
  dateStr: string,
): string[] | null {
  if (schedule.inboundCacheDate !== dateStr) return null
  if (!Array.isArray(schedule.inboundWaybillNos)) return null
  return schedule.inboundWaybillNos.filter((no): no is string => typeof no === 'string' && no.trim().length > 0)
}

export async function saveInboundWaybillCache(input: {
  scheduleId: string
  dateStr: string
  waybillNos: string[]
}): Promise<void> {
  const db = getDb()
  await db
    .update(schema.exitAlarmSchedules)
    .set({
      inboundCacheDate: input.dateStr,
      inboundWaybillNos: input.waybillNos,
      inboundCachedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.exitAlarmSchedules.id, input.scheduleId))
}

/** 到件扫描 inbound/query，提取 waybillNo 列表 */
export async function fetchInboundWaybillNos(input: {
  token: string
  stationCode: string
  dateStr: string
  label?: string
}): Promise<{ ok: true; waybillNos: string[] } | ExitAlarmWaybillFetchError> {
  const normalizedToken = normalizeImileToken(input.token)
  const url = envFirstOr(['IMILE_INBOUND_URL'], DEFAULT_INBOUND_URL)
  const headers = makeInboundHeaders(normalizedToken, input.stationCode)
  const label = input.label ?? '出仓告警到件预取'

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

async function fetchSearchWaybillByNos(input: {
  token: string
  stationCode: string
  dateStr: string
  waybillNos: string[]
  label: string
}): Promise<ExitAlarmWaybillFetchSuccess | ExitAlarmWaybillFetchError> {
  if (input.waybillNos.length === 0) {
    return { ok: true, records: [], waybillNos: [] }
  }

  const normalizedToken = normalizeImileToken(input.token)
  const url = envFirstOr(['IMILE_VENDOR_DS_WAYBILL_URL'], DEFAULT_DS_WAYBILL_URL)
  const headers = makeWaybillHeaders(normalizedToken, input.stationCode)
  const { startTime, endTime } = adelaideDateToMelbourneRange(input.dateStr)
  const batches = chunkArray(input.waybillNos, WAYBILL_BATCH_SIZE)
  const allRecords: ExitAlarmWaybillRow[] = []

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

    allRecords.push(...(result.records as ExitAlarmWaybillRow[]))
    if (i < batches.length - 1) await sleep(WAYBILL_BATCH_DELAY_MS)
  }

  return { ok: true, records: allRecords, waybillNos: input.waybillNos }
}

/** 优先使用缓存 waybillNo；缺失时现拉到件并可选写回缓存 */
export async function fetchExitAlarmWaybills(input: {
  token: string
  stationCode: string
  dateStr: string
  label: string
  cachedWaybillNos?: string[] | null
  scheduleId?: string
  persistInboundCache?: boolean
}): Promise<ExitAlarmWaybillFetchSuccess | ExitAlarmWaybillFetchError> {
  let waybillNos = input.cachedWaybillNos ?? null

  if (!waybillNos) {
    const inbound = await fetchInboundWaybillNos({
      token: input.token,
      stationCode: input.stationCode,
      dateStr: input.dateStr,
      label: `${input.label}-到件`,
    })
    if (!inbound.ok) return inbound
    waybillNos = inbound.waybillNos

    if (input.persistInboundCache && input.scheduleId) {
      await saveInboundWaybillCache({
        scheduleId: input.scheduleId,
        dateStr: input.dateStr,
        waybillNos,
      })
    }
  }

  return fetchSearchWaybillByNos({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    waybillNos,
    label: input.label,
  })
}
