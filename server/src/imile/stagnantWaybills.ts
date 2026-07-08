import { requestImileApi } from './client'
import { buildImilePortalHeaders, IMILE_DS_SAAS_TMS_PORTAL } from './portal'
import { envFirstOr, normalizeImileToken } from './shared'

const DEFAULT_STAGNANT_URL =
  'https://ds.imile.com/saastms/v1/report/stock/daWaybillInventory'

function makeStagnantHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_STAGNANT_WAYBILL',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_VENDOR_LONG_TAIL', 'IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
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
  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_STAGNANT_WAYBILL_URL'], DEFAULT_STAGNANT_URL)
  const headers = makeStagnantHeaders(normalizedToken)
  const body = {
    country: 'AUS',
    currentPage: 1,
    end: params.end,
    fromOc: false,
    ocCenterCode: 'S210206',
    orderTypes: [],
    scanType: '',
    scanTypeList: [],
    showCount: 1000,
    start: params.start,
    stockReportType: 'notClosedTotal',
    stockStationCodes: params.stationCodes,
  }
  console.log('[催派滞留单查询] iMile 请求参数:', { url, body })

  const result = await requestImileApi({ url, method: 'POST', headers, body, label: '催派滞留单查询' })
  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message, rawText: result.rawText }
  }
  const json = result.json as Record<string, unknown>
  const obj = json?.resultObject as Record<string, unknown> | null | undefined
  const items = Array.isArray(obj?.results) ? (obj.results as StagnantWaybillRow[]) : []
  return { ok: true, data: items }
}
