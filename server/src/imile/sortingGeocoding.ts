/**
 * 司机地图坐标来源：iMile 分拣坐标查询（cornerstone/sorting/pageList），按运单号直接拿经纬度，
 * 不再需要地址文本 + 第三方地理编码服务。
 */
import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_OC_SORTING_PORTAL } from './portal'
import { envFirstOr, isRecord, normalizeImileToken, resolveImileCountry } from './shared'
import { AUS_TZ, localDateInTz, localDatePlusDaysMs, type AusTz } from './ausTimezone'
import { localToUtcMs } from './inboundWaybillIndex'

const DEFAULT_SORTING_PAGE_LIST_URL = 'https://oc.imile.com/cornerstone/sorting/pageList'

/**
 * 查询窗口以 dataDate（点位所属的业务日期，非查询时的“今天”）为锚点，不是相对当前时间。
 * 实测同一 dataDate 下 ORDER_CREATE/ORDER_CHANGE 的 lastUpdDate 普遍比 dataDate 早 5~8 天
 * （订单创建到签收/出问题之间有正常时间差），回溯 14 天留足余量；向后 2 天覆盖同日晚间变更。
 */
const SORTING_LOOKBACK_DAYS = 14
const SORTING_LOOKAHEAD_DAYS = 2

/** iMile 硬限制参考 searchWaybill：单次查询单号不超过 1000 条 */
const SORTING_BATCH_SIZE = 1000
const SORTING_PAGE_SHOW_COUNT = 1000
const SORTING_PAGE_DELAY_MS = 300

/** 坐标有效的分拣记录类型；其它 sortType（如中途扫描）不代表收件地址坐标，丢弃 */
const GEOCODE_SORT_TYPES = new Set(['ORDER_CREATE', 'ORDER_CHANGE'])

export type SortingGeocodingSuccess = {
  ok: true
  coordsByWaybillNo: Map<string, { latitude: number; longitude: number }>
}

export type SortingGeocodingError = {
  ok: false
  status?: number
  message: string
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

function makeSortingHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_SORTING',
    defaults: IMILE_OC_SORTING_PORTAL,
    sharedEnvPrefixes: ['IMILE_TRACK'],
  })
}

/** [startDate, endDate] 的 ISO 本地时间字符串（YYYY-MM-DDTHH:mm:ss），以 dataDate 为锚点按时区计算 */
function buildSortingDateRange(dataDate: string, tz: AusTz): { startDate: string; endDate: string } {
  // 用中午做锚点探针，避开 DST 边界歧义（同 localDatePlusDaysMs 的既有用法）
  const anchorMs = localToUtcMs(`${dataDate} 12:00:00`, tz)
  const startMs = localDatePlusDaysMs(anchorMs, tz, -SORTING_LOOKBACK_DAYS, 0, 0, 0)
  const endMs = localDatePlusDaysMs(anchorMs, tz, SORTING_LOOKAHEAD_DAYS, 23, 59, 59)
  return {
    startDate: `${localDateInTz(startMs, tz)}T00:00:00`,
    endDate: `${localDateInTz(endMs, tz)}T23:59:59`,
  }
}

function readWaybillNoFromRow(row: Record<string, unknown>): string {
  const raw = row.inputBusinessNumber
  return typeof raw === 'string' ? raw.trim() : ''
}

/** 坐标在 inputGeocoding.geoCoding，形如 "lat,lng"；不是顶层字段 */
function readGeocodingFromRow(row: Record<string, unknown>): string {
  const geo = row.inputGeocoding
  if (!isRecord(geo)) return ''
  return typeof geo.geoCoding === 'string' ? geo.geoCoding : ''
}

/** 兼容 "YYYY-MM-DD HH:mm:ss" 与 "YYYY-MM-DDTHH:mm:ss" 两种分隔符 */
function parseUpdMs(raw: unknown): number {
  if (typeof raw !== 'string' || !raw.trim()) return 0
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : 0
}

function parseGeocodingPair(raw: unknown): { latitude: number; longitude: number } | null {
  if (typeof raw !== 'string') return null
  const [latStr, lngStr] = raw.split(',').map((s) => s.trim())
  const latitude = Number(latStr)
  const longitude = Number(lngStr)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { latitude, longitude }
}

type SortingRecord = { sortType: string; geocoding: string; lastUpdDate: string }

/**
 * 单运单号可能有多条分拣记录（创建/变更）；只看 ORDER_CREATE / ORDER_CHANGE，
 * 只有一条直接用，多条取 lastUpdDate 最新的一条。
 */
export function pickBestGeocoding(records: SortingRecord[]): { latitude: number; longitude: number } | null {
  const eligible = records.filter((r) => GEOCODE_SORT_TYPES.has(r.sortType))
  if (eligible.length === 0) return null
  let best = eligible[0]!
  for (const r of eligible.slice(1)) {
    if (parseUpdMs(r.lastUpdDate) >= parseUpdMs(best.lastUpdDate)) best = r
  }
  return parseGeocodingPair(best.geocoding)
}

/**
 * 按运单号批量查询坐标（分批 + 分页）。找不到坐标的运单号不会出现在返回的 Map 里。
 */
export async function fetchSortingGeocodingByWaybillNos(input: {
  token: string
  waybillNos: string[]
  /** 点位所属业务日期（YYYY-MM-DD），查询窗口以此为锚点，而非调用时的实际日期 */
  dataDate: string
  label: string
  tz?: AusTz
}): Promise<SortingGeocodingSuccess | SortingGeocodingError> {
  if (input.waybillNos.length === 0) {
    return { ok: true, coordsByWaybillNo: new Map() }
  }

  const token = normalizeImileToken(input.token)
  const url = envFirstOr(['IMILE_SORTING_PAGE_LIST_URL'], DEFAULT_SORTING_PAGE_LIST_URL)
  const headers = makeSortingHeaders(token)
  const { startDate, endDate } = buildSortingDateRange(input.dataDate, input.tz ?? AUS_TZ.Adelaide)

  const recordsByWaybillNo = new Map<string, SortingRecord[]>()

  for (const batch of chunkArray(input.waybillNos, SORTING_BATCH_SIZE)) {
    const result = await fetchPaginatedResultRows({
      label: input.label,
      pageShowCount: SORTING_PAGE_SHOW_COUNT,
      pageDelayMs: SORTING_PAGE_DELAY_MS,
      buildPageBody: ({ currentPage, showCount }) => ({
        currentPage,
        showCount,
        sortStrategy: null,
        inputCountry: resolveImileCountry(),
        startDate,
        endDate,
        waybillNoList: batch,
      }),
      requestPage: (body) => requestImileApi({ url, method: 'POST', headers, body, label: input.label }),
    })

    if (!result.ok) {
      return { ok: false, status: result.status, message: result.message }
    }

    for (const raw of result.records) {
      if (!isRecord(raw)) continue
      const waybillNo = readWaybillNoFromRow(raw)
      if (!waybillNo) continue
      const sortType = typeof raw.sortType === 'string' ? raw.sortType : ''
      const geocoding = readGeocodingFromRow(raw)
      const lastUpdDate = typeof raw.lastUpdDate === 'string' ? raw.lastUpdDate : ''
      const list = recordsByWaybillNo.get(waybillNo)
      if (list) list.push({ sortType, geocoding, lastUpdDate })
      else recordsByWaybillNo.set(waybillNo, [{ sortType, geocoding, lastUpdDate }])
    }
  }

  const coordsByWaybillNo = new Map<string, { latitude: number; longitude: number }>()
  for (const [waybillNo, records] of recordsByWaybillNo) {
    const picked = pickBestGeocoding(records)
    if (picked) coordsByWaybillNo.set(waybillNo, picked)
  }

  return { ok: true, coordsByWaybillNo }
}
