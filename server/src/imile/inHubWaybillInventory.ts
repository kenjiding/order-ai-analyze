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

/**
 * 查询库内在库运单（stockReportType=allTotal），按 start/end 过滤入库日期，返回去重后的运单号列表。
 */
export async function fetchInHubWaybillInventory(
  token: string,
  params: { stationCode: string; start: string; end: string },
): Promise<{ ok: true; data: string[] } | ApiError> {
  const stationCode = params.stationCode.trim()
  if (!stationCode) {
    return { ok: false, status: 400, message: '库内异常订单查询缺少站点编码' }
  }

  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_IN_HUB_WAYBILL_INVENTORY_URL'], DEFAULT_IN_HUB_WAYBILL_INVENTORY_URL)
  const headers = makeInHubHeaders(normalizedToken, stationCode)

  const pageResult = await fetchPaginatedResultRows({
    label: '库内异常订单查询',
    pageShowCount: IN_HUB_WAYBILL_PAGE_SHOW_COUNT,
    buildPageBody: ({ currentPage, showCount }) => ({
      country: resolveImileCountry(),
      currentPage,
      end: params.end,
      fromOc: false,
      ocCenterCode: 'S210206',
      orderTypes: [],
      scanType: '',
      scanTypeList: [],
      showCount,
      start: params.start,
      stockReportType: 'allTotal',
      stockStationCodes: [stationCode],
    }),
    requestPage: (body) =>
      requestImileApi({ url, method: 'POST', headers, body, label: '库内异常订单查询' }),
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
