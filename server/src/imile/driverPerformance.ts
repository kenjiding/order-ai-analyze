import { requestImileApi } from './client'
import { buildImilePortalHeaders, IMILE_OC_INTERCEPT_PORTAL } from './portal'
import { envFirstOr, normalizeImileToken, resolveImileCountry } from './shared'
import { resolveRegionTz } from './ausTimezone'
import { syncStationDayWaybillsIncremental } from './stationDayWaybillSync'

const DEFAULT_RETURN_WARNING_URL =
  'https://oc.imile.com/saastms/v1/report/stock/daWaybillInventory'

function makeDriverReturnHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_DRIVER_RETURN',
    defaults: IMILE_OC_INTERCEPT_PORTAL,
    sharedEnvPrefixes: ['IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
  })
}

export type DriverWaybillRow = {
  courier?: string
  courierCode?: string
  courierVendor?: string
  courierVendorCode?: string
  routeCode?: string
  signDate?: string
  deliveryTime?: string
  [key: string]: unknown
}

export type DriverReturnRow = {
  driverName?: string
  driverCode?: string
  driverVendorName?: string
  driverVendorCode?: string
  ofdDate?: string
  [key: string]: unknown
}

type ApiError = { ok: false; status: number; message: string; rawText?: string }

/**
 * 24小时派签率运单查询：增量同步站点日缓存，直接复用同步结果里已在内存中的全量行。
 * 已达标 / 已超 24H 窗口的单号不会再次 searchWaybill；同步结果不再需要额外整表 SELECT 一次。
 */
export async function fetchDriverWaybills(
  token: string,
  params: {
    stationCode: string
    dateStr: string
    regionCode?: string | null
    /** 见 fetchWaybillDetailsIncremental.forceIndexRefresh：结算类调用必须传 true */
    forceIndexRefresh?: boolean
    /** 见 fetchWaybillDetailsIncremental.forceDetailRefresh：要求字段完整的结算类调用必须传 true */
    forceDetailRefresh?: boolean
    /** 见 fetchWaybillDetailsIncremental.skipDetailFetch */
    skipDetailFetch?: boolean
  },
): Promise<{ ok: true; data: DriverWaybillRow[] } | ApiError> {
  const tz = resolveRegionTz(params.regionCode)
  const synced = await syncStationDayWaybillsIncremental({
    token,
    stationCode: params.stationCode,
    dataDate: params.dateStr,
    tz,
    label: '24H派签率运单查询',
    forceIndexRefresh: params.forceIndexRefresh,
    forceDetailRefresh: params.forceDetailRefresh,
    skipDetailFetch: params.skipDetailFetch,
  })
  if (!synced.ok) return { ok: false, status: 502, message: synced.message }
  return { ok: true, data: synced.rows as DriverWaybillRow[] }
}

export async function fetchDriverReturnWarning(
  token: string,
  params: { stationCodes: string[] },
): Promise<{ ok: true; data: DriverReturnRow[] } | ApiError> {
  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_DRIVER_RETURN_URL'], DEFAULT_RETURN_WARNING_URL)
  const headers = makeDriverReturnHeaders(normalizedToken)
  const body = {
    country: resolveImileCountry(),
    currentPage: 1,
    end: '',
    fromOc: true,
    ocCenterCode: 'S210206',
    orderTypes: [],
    scanType: '',
    scanTypeList: [],
    showCount: 5000,
    start: '',
    stockReportType: 'allTotal',
    stockStationCodes: params.stationCodes,
  }
  const result = await requestImileApi({ url, method: 'POST', headers, body, label: '归班预警查询' })
  if (!result.ok) return { ok: false, status: result.status, message: result.message, rawText: result.rawText }
  const json = result.json as Record<string, unknown>
  const obj = json?.resultObject as Record<string, unknown> | null | undefined
  const items = Array.isArray(obj?.results) ? (obj.results as DriverReturnRow[]) : []
  return { ok: true, data: items }
}
