import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DS_SAAS_TMS_PORTAL } from './portal'
import { envFirstOr, isRecord, normalizeImileToken, resolveImileCountry } from './shared'

const DEFAULT_IN_HUB_WAYBILL_INVENTORY_URL =
  'https://ds.imile.com/saastms/v1/report/stock/inHubWaybillInbentory'

const IN_HUB_WAYBILL_PAGE_SHOW_COUNT = 1000

function makeInHubHeaders(token: string, hubcode: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_IN_HUB_WAYBILL_INVENTORY',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_STAGNANT_WAYBILL', 'IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
    // hubcode 必须与查询站点一致，否则接口成功但 results 为空（默认 hub 是阿德莱德）
    overrides: { hubcode },
  })
}

/** 基于基准日字符串（YYYY-MM-DD）按天数偏移得到新的 YYYY-MM-DD（纯日历运算，与时区无关） */
function shiftDate(baseDateStr: string, minusDays: number): string {
  const [y, m, d] = baseDateStr.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) - minusDays * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * 计算"库内滞留天数大于 greaterDays、小于 lessDays"对应的 inHubWaybillInbentory start/end 参数。
 * 例：基准日 2026-07-18，greaterDays=2, lessDays=3 → start=2026-07-15, end=2026-07-16。
 */
export function computeInHubStockRange(
  todayStr: string,
  greaterDays: number,
  lessDays: number,
): { start: string; end: string } {
  return {
    start: shiftDate(todayStr, lessDays),
    end: shiftDate(todayStr, greaterDays),
  }
}

type ApiError = { ok: false; status: number; message: string; rawText?: string }

type FetchInHubWaybillNosParams = {
  stationCode: string
  start: string
  end: string
  scanType: string
  stockReportType: string
  ocCenterCode: string
  label: string
}

async function fetchInHubWaybillNos(
  token: string,
  params: FetchInHubWaybillNosParams,
): Promise<{ ok: true; data: string[] } | ApiError> {
  const stationCode = params.stationCode.trim()
  if (!stationCode) {
    return { ok: false, status: 400, message: `${params.label}缺少站点编码` }
  }

  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_IN_HUB_WAYBILL_INVENTORY_URL'], DEFAULT_IN_HUB_WAYBILL_INVENTORY_URL)
  const headers = makeInHubHeaders(normalizedToken, stationCode)

  const pageResult = await fetchPaginatedResultRows({
    label: params.label,
    pageShowCount: IN_HUB_WAYBILL_PAGE_SHOW_COUNT,
    buildPageBody: ({ currentPage, showCount }) => ({
      country: resolveImileCountry(),
      currentPage,
      end: params.end,
      fromOc: false,
      ocCenterCode: params.ocCenterCode,
      orderTypes: [],
      scanType: params.scanType,
      scanTypeList: [],
      showCount,
      start: params.start,
      stockReportType: params.stockReportType,
      stockStationCodes: [stationCode],
    }),
    requestPage: (body) =>
      requestImileApi({ url, method: 'POST', headers, body, label: params.label }),
  })

  if (!pageResult.ok) {
    return {
      ok: false,
      status: pageResult.status,
      message: pageResult.message,
      rawText: pageResult.rawText,
    }
  }

  const waybillNos = new Set<string>()
  for (const row of pageResult.records) {
    if (!isRecord(row)) continue
    const waybillNo = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
    if (waybillNo) waybillNos.add(waybillNo)
  }

  return { ok: true, data: [...waybillNos] }
}

/**
 * 查询库内在库运单（stockReportType=allTotal），按 start/end 过滤入库日期，返回去重后的运单号列表。
 */
export async function fetchInHubWaybillInventory(
  token: string,
  params: { stationCode: string; start: string; end: string },
): Promise<{ ok: true; data: string[] } | ApiError> {
  return fetchInHubWaybillNos(token, {
    stationCode: params.stationCode,
    start: params.start,
    end: params.end,
    scanType: '',
    stockReportType: 'allTotal',
    ocCenterCode: 'S210206',
    label: '库内异常订单查询',
  })
}

export const IN_HUB_PACKAGE_LOSS_SCAN_TYPES = ['1504', '400'] as const
export const IN_HUB_PACKAGE_LOSS_STOCK_REPORT_TYPES = ['notClosed', 'closed'] as const

export type InHubPackageLossScanType = (typeof IN_HUB_PACKAGE_LOSS_SCAN_TYPES)[number]
export type InHubPackageLossStockReportType =
  (typeof IN_HUB_PACKAGE_LOSS_STOCK_REPORT_TYPES)[number]

export type InHubPackageLossQuery = {
  scanType: InHubPackageLossScanType
  stockReportType: InHubPackageLossStockReportType
}

/** 库内丢包取号：未关闭 + 已关闭，各拉 scanType 1504 / 400。 */
export const IN_HUB_PACKAGE_LOSS_QUERIES: readonly InHubPackageLossQuery[] =
  IN_HUB_PACKAGE_LOSS_STOCK_REPORT_TYPES.flatMap((stockReportType) =>
    IN_HUB_PACKAGE_LOSS_SCAN_TYPES.map((scanType) => ({ scanType, stockReportType })),
  )

export type MergedWaybillNos = {
  waybillNos: string[]
  total: number
  byScanType: Record<string, number>
}

/** 合并多组运单号并去重；同 scanType 多组（未关闭/已关闭）先并集再计数。 */
export function mergeWaybillNosByScanType(
  groups: { scanType: string; waybillNos: string[] }[],
): MergedWaybillNos {
  const byScanTypeSets: Record<string, Set<string>> = {}
  const merged = new Set<string>()
  for (const group of groups) {
    if (!byScanTypeSets[group.scanType]) byScanTypeSets[group.scanType] = new Set()
    for (const raw of group.waybillNos) {
      const no = raw.trim()
      if (!no) continue
      byScanTypeSets[group.scanType].add(no)
      merged.add(no)
    }
  }
  const byScanType: Record<string, number> = {}
  for (const [scanType, set] of Object.entries(byScanTypeSets)) {
    byScanType[scanType] = set.size
  }
  return { waybillNos: [...merged], total: merged.size, byScanType }
}

export async function fetchInHubPackageLossByQuery(
  token: string,
  params: { stationCode: string } & InHubPackageLossQuery,
): Promise<{ ok: true; data: string[] } | ApiError> {
  return fetchInHubWaybillNos(token, {
    stationCode: params.stationCode,
    start: '',
    end: '',
    scanType: params.scanType,
    stockReportType: params.stockReportType,
    ocCenterCode: '',
    label: `库内丢包查询 scanType=${params.scanType} stockReportType=${params.stockReportType}`,
  })
}

export async function fetchInHubPackageLossWaybills(
  token: string,
  stationCode: string,
): Promise<({ ok: true } & MergedWaybillNos) | ApiError> {
  const results = await Promise.all(
    IN_HUB_PACKAGE_LOSS_QUERIES.map(async (query) => {
      const result = await fetchInHubPackageLossByQuery(token, { stationCode, ...query })
      return { ...query, result }
    }),
  )

  for (const { scanType, stockReportType, result } of results) {
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        message: `scanType ${scanType} / ${stockReportType}：${result.message}`,
        rawText: result.rawText,
      }
    }
  }

  return {
    ok: true,
    ...mergeWaybillNosByScanType(
      results.map(({ scanType, result }) => ({
        scanType,
        waybillNos: result.ok ? result.data : [],
      })),
    ),
  }
}
