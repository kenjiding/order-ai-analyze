import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import {
  buildImilePortalHeaders,
  IMILE_DS_SAAS_TMS_PORTAL,
  IMILE_OC_INTERCEPT_PORTAL,
} from './portal'
import { envFirstOr, normalizeImileToken } from './shared'

const DEFAULT_DRIVER_WAYBILL_URL =
  'https://ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'

const DEFAULT_RETURN_WARNING_URL =
  'https://oc.imile.com/saastms/v1/report/stock/daWaybillInventory'

function makeDriverWaybillHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_DRIVER_WAYBILL',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
  })
}

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

const DRIVER_WAYBILL_PAGE_SIZE = 1000
const PAGE_DELAY_MS = 500

export async function fetchDriverWaybills(
  token: string,
  params: { startTime: string; endTime: string },
): Promise<{ ok: true; data: DriverWaybillRow[] } | ApiError> {
  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_DRIVER_WAYBILL_URL'], DEFAULT_DRIVER_WAYBILL_URL)
  const headers = makeDriverWaybillHeaders(normalizedToken)

  const result = await fetchPaginatedResultRows({
    label: '司机运单查询',
    pageShowCount: DRIVER_WAYBILL_PAGE_SIZE,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) => ({
      actualReceiveStation: '',
      currentPage,
      dateSearchType: 'receive',
      endTime: params.endTime,
      labelOrderCodes: [] as string[],
      mainWaybillNos: [] as string[],
      platformNos: [] as string[],
      referenceNos: [] as string[],
      showCount,
      startTime: params.startTime,
      waybillNos: [] as string[],
    }),
    requestPage: (body) =>
      requestImileApi({ url, method: 'POST', headers, body, label: '司机运单查询' }),
  })

  if (!result.ok) return { ok: false, status: result.status, message: result.message }
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
