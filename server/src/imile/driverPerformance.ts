import { requestImileApi } from './client'
import { buildImilePortalHeaders, IMILE_OC_INTERCEPT_PORTAL } from './portal'
import { envFirstOr, normalizeImileToken } from './shared'
import { resolveRegionTz } from './ausTimezone'
import { fetchWaybillDetailsByInboundIndex } from './inboundWaybillIndex'

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

/** 24小时派签率运单查询：与 11 点前出仓率一致，先取到件 waybillNo 索引，再分批 searchWaybill */
export async function fetchDriverWaybills(
  token: string,
  params: { stationCode: string; dateStr: string; regionCode?: string | null },
): Promise<{ ok: true; data: DriverWaybillRow[] } | ApiError> {
  const result = await fetchWaybillDetailsByInboundIndex({
    token,
    stationCode: params.stationCode,
    dateStr: params.dateStr,
    label: '24H派签率运单查询',
    tz: resolveRegionTz(params.regionCode),
  })
  if (!result.ok) return { ok: false, status: result.status ?? 502, message: result.message }
  return { ok: true, data: result.records as DriverWaybillRow[] }
}

export async function fetchDriverReturnWarning(
  token: string,
  params: { stationCodes: string[] },
): Promise<{ ok: true; data: DriverReturnRow[] } | ApiError> {
  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_DRIVER_RETURN_URL'], DEFAULT_RETURN_WARNING_URL)
  const headers = makeDriverReturnHeaders(normalizedToken)
  const body = {
    country: 'AUS',
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
