import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DS_SAAS_TMS_PORTAL } from './portal'
import { envFirstOr, normalizeImileToken, resolveImileCountry } from './shared'
import { queryWaybillDetailsByNos } from './waybillDetailsDb'

const DEFAULT_STAGNANT_URL =
  'https://ds.imile.com/saastms/v1/report/stock/daWaybillInventory'

const STAGNANT_PAGE_SHOW_COUNT = 1000

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
 * 以 2026-07-14 为例：
 *   '0-1' → start=D(07-14) end=''；
 *   '1-2' → start=D-2(07-12) end=D-1(07-13)；
 *   '3-4' → start=D-4(07-10) end=D-3(07-11)；
 *   '7+'  → start='' end=D-7(07-07)。
 */
const BUCKET_OFFSETS: Record<StagnationBucket, { start: number | null; end: number | null }> = {
  '0-1': { start: 0, end: null },
  '1-2': { start: 2, end: 1 },
  '2-3': { start: 3, end: 2 },
  '3-4': { start: 4, end: 3 },
  '4-5': { start: 5, end: 4 },
  '5-6': { start: 6, end: 5 },
  '6-7': { start: 7, end: 6 },
  '7+': { start: null, end: 7 },
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
      country: resolveImileCountry(),
      currentPage,
      end: params.end,
      fromOc: false,
      ocCenterCode: 'S210206',
      orderTypes: ['100'],
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

export type StagnantWaybillLookupMaps = {
  routeCodeByWaybillNo: Map<string, string>
  /** 商家编码，供催派按「优先客户配置」打标 */
  clientCodeByWaybillNo: Map<string, string>
}

function emptyLookupMaps(): StagnantWaybillLookupMaps {
  return { routeCodeByWaybillNo: new Map(), clientCodeByWaybillNo: new Map() }
}

/**
 * 按 waybillNo 批量查询运单明细，提取路由码（consigneeRouteCode）与商家编码（clientCode）。
 * 路由码供催派按供应商 routeCode 二次筛选；clientCode 供「本地件优先客户」打标。
 * 查不到的单号不出现在对应映射里。
 */
export async function fetchStagnantWaybillRouteCodes(
  // token/stationCode 不再用于鉴权 HTTP 调用，保留是为了不改调用方的传参签名；
  // 换接入真实 DB 时如需按站点分片查询，可以在这里重新用上 _stationCode。
  _token: string,
  waybillNos: string[],
  _stationCode: string,
): Promise<{ ok: true; data: StagnantWaybillLookupMaps } | ApiError> {
  const uniqueNos = [...new Set(waybillNos.filter((no) => typeof no === 'string' && no.trim().length > 0))]
  const result = emptyLookupMaps()
  if (uniqueNos.length === 0) return { ok: true, data: result }

  const records = await queryWaybillDetailsByNos(uniqueNos)
  for (const row of records) {
    const waybillNo = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
    if (!waybillNo) continue
    const consigneeRouteCode = typeof row.consigneeRouteCode === 'string' ? row.consigneeRouteCode.trim() : ''
    if (consigneeRouteCode) result.routeCodeByWaybillNo.set(waybillNo, consigneeRouteCode)
    const clientCode = typeof row.clientCode === 'string' ? row.clientCode.trim() : ''
    if (clientCode) result.clientCodeByWaybillNo.set(waybillNo, clientCode)
  }

  return { ok: true, data: result }
}
