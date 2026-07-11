import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DS_SAAS_TMS_PORTAL } from './portal'
import { envFirstOr, isRecord, normalizeImileToken, sleep } from './shared'

const DEFAULT_STAGNANT_URL =
  'https://ds.imile.com/saastms/v1/report/stock/daWaybillInventory'
const DEFAULT_SEARCH_WAYBILL_URL = 'https://ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'

const STAGNANT_PAGE_SHOW_COUNT = 1000

/** iMile 硬限制：单次查询单号不超过 1000 条 */
const ROUTE_CODE_QUERY_BATCH_SIZE = 1000
const ROUTE_CODE_PAGE_SHOW_COUNT = 1000
const ROUTE_CODE_PAGE_DELAY_MS = 300
const ROUTE_CODE_BATCH_DELAY_MS = 300

function makeStagnantHeaders(token: string, hubcode: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_STAGNANT_WAYBILL',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_VENDOR_LONG_TAIL', 'IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
    // hubcode 必须与查询站点一致，否则接口成功但 results 为空（默认 hub 是阿德莱德）
    overrides: { hubcode },
  })
}

/** 滞留时间区间（催派推送）。值即前后端约定标识 */
export type StagnationBucket = '0-1' | '1-2' | '2-3' | '3-4' | '4-5' | '5-6' | '6-7' | '7+'

export const STAGNATION_BUCKETS: readonly StagnationBucket[] = [
  '0-1', '1-2', '2-3', '3-4', '4-5', '5-6', '6-7', '7+',
]

export function isStagnationBucket(raw: unknown): raw is StagnationBucket {
  return typeof raw === 'string' && (STAGNATION_BUCKETS as readonly string[]).includes(raw)
}

/** 区间中文展示标签，如 '0-1' → '0~1 天'，'7+' → '≥7 天' */
export function stagnationBucketLabel(bucket: StagnationBucket): string {
  return bucket === '7+' ? '≥7 天' : `${bucket.replace('-', '~')} 天`
}

/**
 * 各区间相对基准日 D 的日期偏移（天）。null 表示该端不设界（传空串）。
 * 以 2026-07-05 为例：
 *   '0-1' → start=D(07-05) end=''；'1-2' → start=D-1(07-04) end=D(07-05)；
 *   '7+'  → start='' end=D-6(06-29)。
 */
const BUCKET_OFFSETS: Record<StagnationBucket, { start: number | null; end: number | null }> = {
  '0-1': { start: 0, end: null },
  '1-2': { start: 1, end: 0 },
  '2-3': { start: 2, end: 1 },
  '3-4': { start: 3, end: 2 },
  '4-5': { start: 4, end: 3 },
  '5-6': { start: 5, end: 4 },
  '6-7': { start: 6, end: 5 },
  '7+': { start: null, end: 6 },
}

/** 基于基准日字符串（YYYY-MM-DD）按天数偏移得到新的 YYYY-MM-DD（纯日历运算，与时区无关） */
function shiftDate(baseDateStr: string, minusDays: number): string {
  const [y, m, d] = baseDateStr.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) - minusDays * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

/** 计算某滞留区间对应的 daWaybillInventory start/end 参数（空串表示不设界） */
export function computeStagnationRange(
  baseDateStr: string,
  bucket: StagnationBucket,
): { start: string; end: string } {
  const off = BUCKET_OFFSETS[bucket]
  return {
    start: off.start === null ? '' : shiftDate(baseDateStr, off.start),
    end: off.end === null ? '' : shiftDate(baseDateStr, off.end),
  }
}

/** daWaybillInventory 返回的单条滞留运单 */
export type StagnantWaybillRow = {
  waybillNo?: string
  driverName?: string
  driverCode?: string
  driverVendorName?: string
  driverVendorCode?: string
  ofdDate?: string
  [key: string]: unknown
}

type ApiError = { ok: false; status: number; message: string; rawText?: string }

/**
 * 查询未妥投滞留运单（stockReportType=notClosedTotal），按 start/end 过滤派件日期。
 * 对应催派推送的每个滞留区间发起一次请求。
 */
export async function fetchStagnantWaybills(
  token: string,
  params: { stationCodes: string[]; start: string; end: string },
): Promise<{ ok: true; data: StagnantWaybillRow[] } | ApiError> {
  const hubcode = params.stationCodes.map((c) => c.trim()).find(Boolean)
  if (!hubcode) {
    return { ok: false, status: 400, message: '催派滞留单查询缺少站点编码' }
  }

  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_STAGNANT_WAYBILL_URL'], DEFAULT_STAGNANT_URL)
  const headers = makeStagnantHeaders(normalizedToken, hubcode)

  console.log('[催派滞留单查询] iMile 请求参数:', {
    url,
    hubcode,
    start: params.start,
    end: params.end,
    stockStationCodes: params.stationCodes,
  })

  const pageResult = await fetchPaginatedResultRows({
    label: '催派滞留单查询',
    pageShowCount: STAGNANT_PAGE_SHOW_COUNT,
    buildPageBody: ({ currentPage, showCount }) => ({
      country: 'AUS',
      currentPage,
      end: params.end,
      fromOc: false,
      ocCenterCode: 'S210206',
      orderTypes: [],
      scanType: '',
      scanTypeList: [],
      showCount,
      start: params.start,
      stockReportType: 'notClosedTotal',
      stockStationCodes: params.stationCodes,
    }),
    requestPage: (body) =>
      requestImileApi({ url, method: 'POST', headers, body, label: '催派滞留单查询' }),
  })

  if (!pageResult.ok) {
    return {
      ok: false,
      status: pageResult.status,
      message: pageResult.message,
      rawText: pageResult.rawText,
    }
  }
  return { ok: true, data: pageResult.records as StagnantWaybillRow[] }
}

function makeRouteCodeHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_CHASE_DISPATCH_ROUTE_CODE',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_STAGNANT_WAYBILL', 'IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
  })
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** 查询窗口足够宽，覆盖任意滞留单的下单日期，不依赖滞留区间本身的起止日期 */
function wideRouteCodeSearchWindow(): { startTime: string; endTime: string } {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const endDate = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  return { startTime: '2018-01-01 00:00:00', endTime: `${endDate} 23:59:59` }
}

/**
 * 按 waybillNo 批量查询 searchWaybill，只提取路由码（consigneeRouteCode），供路由码白名单过滤使用。
 * 返回 waybillNo -> consigneeRouteCode 映射；查不到的单号不出现在结果里。
 */
export async function fetchStagnantWaybillRouteCodes(
  token: string,
  waybillNos: string[],
): Promise<{ ok: true; data: Map<string, string> } | ApiError> {
  const uniqueNos = [...new Set(waybillNos.filter((no) => typeof no === 'string' && no.trim().length > 0))]
  const result = new Map<string, string>()
  if (uniqueNos.length === 0) return { ok: true, data: result }

  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_CHASE_DISPATCH_ROUTE_CODE_URL'], DEFAULT_SEARCH_WAYBILL_URL)
  const headers = makeRouteCodeHeaders(normalizedToken)
  const { startTime, endTime } = wideRouteCodeSearchWindow()
  const batches = chunkArray(uniqueNos, ROUTE_CODE_QUERY_BATCH_SIZE)

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]
    const pageResult = await fetchPaginatedResultRows({
      label: '催派滞留单路由码查询',
      pageShowCount: ROUTE_CODE_PAGE_SHOW_COUNT,
      pageDelayMs: ROUTE_CODE_PAGE_DELAY_MS,
      buildPageBody: ({ currentPage, showCount }) => ({
        actualReceiveStation: '',
        currentPage,
        dateSearchType: 'waybill',
        startTime,
        endTime,
        labelOrderCodes: [] as string[],
        mainWaybillNos: [] as string[],
        platformNos: [] as string[],
        referenceNos: [] as string[],
        showCount,
        waybillNos: batch,
      }),
      requestPage: (body) =>
        requestImileApi({ url, method: 'POST', headers, body, label: '催派滞留单路由码查询' }),
    })

    if (!pageResult.ok) return { ok: false, status: pageResult.status, message: pageResult.message }

    for (const row of pageResult.records) {
      if (!isRecord(row)) continue
      const waybillNo = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
      const consigneeRouteCode = typeof row.consigneeRouteCode === 'string' ? row.consigneeRouteCode.trim() : ''
      if (waybillNo && consigneeRouteCode) result.set(waybillNo, consigneeRouteCode)
    }

    if (i < batches.length - 1) await sleep(ROUTE_CODE_BATCH_DELAY_MS)
  }

  return { ok: true, data: result }
}
