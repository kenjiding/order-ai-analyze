import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import {
  buildImilePortalHeaders,
  IMILE_DS_CLOSURE_PORTAL,
  IMILE_DS_SAAS_TMS_PORTAL,
  IMILE_GLOBALCS_PORTAL,
  IMILE_DC_SCAN_QUERY_PORTAL,
} from './portal'
import { envFirstOr, normalizeImileToken } from './shared'

const DEFAULT_STATION_URL =
  'https://ds.imile.com/lm/express/base/v1/search/auth/permission/station'

const DEFAULT_VENDOR_URL =
  'https://ds.imile.com/lm/express/base/v1/biz/vendor/getSimpleList'

const DEFAULT_COMPLAINT_URL =
  'https://globalcs.imile.com/ticket/biz/work/order/ticketQueryByWorkOrderType'

const DEFAULT_WAYBILL_URL =
  'https://dc.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'

const DEFAULT_LONG_TAIL_URL =
  'https://ds.imile.com/saastms/v1/report/stock/daWaybillInventory'

export type VendorAnalysisError = { ok: false; status: number; message: string; rawText?: string }
export type VendorAnalysisSuccess<T> = { ok: true; data: T }

function makeDsLmHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_VENDOR_ANALYSIS',
    defaults: IMILE_DS_CLOSURE_PORTAL,
    sharedEnvPrefixes: ['IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
  })
}

function makeGlobalcsHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_GLOBALCS',
    defaults: IMILE_GLOBALCS_PORTAL,
  })
}

function makeDcWaybillHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_VENDOR_WAYBILL',
    defaults: IMILE_DC_SCAN_QUERY_PORTAL,
    sharedEnvPrefixes: ['IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
  })
}

function makeDsSaasTmsHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_VENDOR_LONG_TAIL',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
  })
}

export async function fetchVendorStations(
  token: string,
): Promise<VendorAnalysisSuccess<unknown[]> | VendorAnalysisError> {
  const normalizedToken = normalizeImileToken(token)
  const baseUrl = envFirstOr(['IMILE_VENDOR_STATION_URL'], DEFAULT_STATION_URL)
  const url = `${baseUrl}?status=ACTIVE&countries=AUS&ocType=DS,AGENT`
  const headers = makeDsLmHeaders(normalizedToken)

  const result = await requestImileApi({ url, method: 'GET', headers, label: '责任站点列表' })
  if (!result.ok) return { ok: false, status: result.status, message: result.message, rawText: result.rawText }

  const json = result.json as Record<string, unknown>
  const items = Array.isArray(json?.resultObject) ? (json.resultObject as unknown[]) : []
  return { ok: true, data: items }
}

export async function fetchVendors(
  token: string,
): Promise<VendorAnalysisSuccess<unknown[]> | VendorAnalysisError> {
  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_VENDOR_LIST_URL'], DEFAULT_VENDOR_URL)
  const headers = makeDsLmHeaders(normalizedToken)

  const result = await requestImileApi({ url, method: 'POST', headers, body: {}, label: '供应商列表' })
  if (!result.ok) return { ok: false, status: result.status, message: result.message, rawText: result.rawText }

  const json = result.json as Record<string, unknown>
  const items = Array.isArray(json?.resultObject) ? (json.resultObject as unknown[]) : []
  return { ok: true, data: items }
}

export type ComplaintTicketsParams = {
  startTime: string
  endTime: string
}

export async function fetchComplaintTickets(
  token: string,
  params: ComplaintTicketsParams,
): Promise<VendorAnalysisSuccess<unknown[]> | VendorAnalysisError> {
  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_GLOBALCS_COMPLAINT_URL'], DEFAULT_COMPLAINT_URL)
  const headers = makeGlobalcsHeaders(normalizedToken)

  const body = {
    acceptCountry: 'AUS',
    adjudicateIsResponsible: '1',
    adjudicateReason: [],
    arbitrationOrderStatusList: [],
    categoryValueList: [],
    channelList: [],
    createUserCode: '',
    currentHandlerCode: '',
    currentPage: 1,
    dateSearchType: 'workOrderCreateDate',
    endTime: params.endTime,
    handlerStationCode: '',
    investigationResultList: [],
    mainTypeId: '1084934573554556928',
    orderCode: '',
    orderStatusList: ['closed'],
    queryScope: 'All',
    querySource: 1,
    questionnaireStatusList: [],
    responsibleDeptCode: [],
    responsibleEmployeeCode: [],
    responsibleParty: '',
    scrollId: null,
    searchType: 'orderCode',
    searchValue: '',
    showCount: 5000,
    startTime: params.startTime,
    submitOcCodeList: [],
    submitRegionCode: '',
    submitterClientCodeList: [],
    submitterDeptId: '',
    submitterSourceList: [],
    timeoutTypeList: [],
    typeIds: [],
    workOrderType: 'complaint',
  }

  const result = await requestImileApi({ url, method: 'POST', headers, body, label: '客诉工单查询' })
  if (!result.ok) return { ok: false, status: result.status, message: result.message, rawText: result.rawText }

  const json = result.json as Record<string, unknown>
  const obj = json?.resultObject as Record<string, unknown> | null | undefined
  const items = Array.isArray(obj?.results) ? (obj.results as unknown[]) : []
  return { ok: true, data: items }
}

export type UnprocessedTicketsParams = {
  startTime: string
  endTime: string
}

export type UnprocessedTicketsResult = {
  normalTickets: unknown[]
  complaintTickets: unknown[]
  arbitrationTickets: unknown[]
}

async function fetchTicketsByWorkOrderType(
  token: string,
  params: {
    startTime: string
    endTime: string
    workOrderType: string
    mainTypeId: string
    orderStatusList: string[]
  },
): Promise<VendorAnalysisSuccess<unknown[]> | VendorAnalysisError> {
  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_GLOBALCS_COMPLAINT_URL'], DEFAULT_COMPLAINT_URL)
  const headers = makeGlobalcsHeaders(normalizedToken)

  const body = {
    acceptCountry: 'AUS',
    adjudicateIsResponsible: '',
    adjudicateReason: [],
    arbitrationOrderStatusList: [],
    categoryValueList: [],
    channelList: [],
    createUserCode: '',
    currentHandlerCode: '',
    currentPage: 1,
    dateSearchType: 'workOrderCreateDate',
    endTime: params.endTime,
    handlerStationCode: '',
    investigationResultList: [],
    mainTypeId: params.mainTypeId,
    orderCode: '',
    orderStatusList: params.orderStatusList,
    queryScope: 'All',
    querySource: 1,
    questionnaireStatusList: [],
    responsibleDeptCode: [],
    responsibleEmployeeCode: [],
    responsibleParty: '',
    scrollId: null,
    searchType: 'orderCode',
    searchValue: '',
    showCount: 5000,
    startTime: params.startTime,
    submitOcCodeList: [],
    submitRegionCode: '',
    submitterClientCodeList: [],
    submitterDeptId: '',
    submitterSourceList: [],
    timeoutTypeList: [],
    typeIds: [],
    workOrderType: params.workOrderType,
  }

  const label = `工单查询(${params.workOrderType})`
  const result = await requestImileApi({ url, method: 'POST', headers, body, label })
  if (!result.ok) return { ok: false, status: result.status, message: result.message, rawText: result.rawText }

  const json = result.json as Record<string, unknown>
  const obj = json?.resultObject as Record<string, unknown> | null | undefined
  const items = Array.isArray(obj?.results) ? (obj.results as unknown[]) : []
  return { ok: true, data: items }
}

export async function fetchUnprocessedTickets(
  token: string,
  params: UnprocessedTicketsParams,
): Promise<VendorAnalysisSuccess<UnprocessedTicketsResult> | VendorAnalysisError> {
  const [normalRes, complaintRes, arbitrationRes] = await Promise.all([
    fetchTicketsByWorkOrderType(token, {
      startTime: params.startTime,
      endTime: params.endTime,
      workOrderType: 'normal',
      mainTypeId: '1084982732691562497',
      orderStatusList: ['pending', 'processing'],
    }),
    fetchTicketsByWorkOrderType(token, {
      startTime: params.startTime,
      endTime: params.endTime,
      workOrderType: 'complaint',
      mainTypeId: '1084934573554556928',
      orderStatusList: ['pending', 'processing'],
    }),
    fetchTicketsByWorkOrderType(token, {
      startTime: params.startTime,
      endTime: params.endTime,
      workOrderType: 'arbitration',
      mainTypeId: '1267665135288328192',
      orderStatusList: ['1', '3'],
    }),
  ])

  if (!normalRes.ok) return normalRes
  if (!complaintRes.ok) return complaintRes
  if (!arbitrationRes.ok) return arbitrationRes

  return {
    ok: true,
    data: {
      normalTickets: normalRes.data,
      complaintTickets: complaintRes.data,
      arbitrationTickets: arbitrationRes.data,
    },
  }
}

export type WaybillParams = {
  startTime: string
  endTime: string
}

const WAYBILL_PAGE_SIZE = 1000
const WAYBILL_CONCURRENCY = 2
const WAYBILL_PAGE_DELAY_MS = 400

export async function fetchVendorWaybills(
  token: string,
  params: WaybillParams,
): Promise<VendorAnalysisSuccess<unknown[]> | VendorAnalysisError> {
  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_VENDOR_WAYBILL_URL'], DEFAULT_WAYBILL_URL)
  const headers = makeDcWaybillHeaders(normalizedToken)

  const result = await fetchPaginatedResultRows({
    label: '供应商运单查询',
    pageShowCount: WAYBILL_PAGE_SIZE,
    concurrency: WAYBILL_CONCURRENCY,
    pageDelayMs: WAYBILL_PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) => ({
      actualReceiveStation: '',
      currentPage,
      dateSearchType: 'firstCountry',
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
      requestImileApi({ url, method: 'POST', headers, body, label: '供应商运单查询' }),
  })

  if (!result.ok) return { ok: false, status: result.status, message: result.message }
  return { ok: true, data: result.records }
}

export type LongTailOrdersParams = {
  stationCodes: string[]
}

function sevenDaysAgo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().slice(0, 10)
}

export async function fetchLongTailOrders(
  token: string,
  params: LongTailOrdersParams,
): Promise<VendorAnalysisSuccess<unknown[]> | VendorAnalysisError> {
  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_VENDOR_LONG_TAIL_URL'], DEFAULT_LONG_TAIL_URL)
  const headers = makeDsSaasTmsHeaders(normalizedToken)

  const body = {
    country: 'AUS',
    currentPage: 1,
    end: sevenDaysAgo(),
    fromOc: false,
    ocCenterCode: 'S210206',
    orderTypes: [],
    scanType: '500',
    scanTypeList: ['500'],
    showCount: 5000,
    start: '',
    stockReportType: 'notClosed',
    stockStationCodes: params.stationCodes,
  }

  console.log('[长尾单] 请求参数:', JSON.stringify(body, null, 2))

  const result = await requestImileApi({ url, method: 'POST', headers, body, label: '长尾单查询' })
  if (!result.ok) {
    console.log('[长尾单] 请求失败:', result.status, result.message)
    return { ok: false, status: result.status, message: result.message, rawText: result.rawText }
  }

  const json = result.json as Record<string, unknown>
  const obj = json?.resultObject as Record<string, unknown> | null | undefined
  const items = Array.isArray(obj?.results) ? (obj.results as unknown[]) : []

  console.log('[长尾单] 返回总条数:', items.length)
  if (items.length > 0) {
    console.log('[长尾单] 第一条数据:', JSON.stringify(items[0], null, 2))
  } else {
    console.log('[长尾单] 原始 resultObject:', JSON.stringify(obj, null, 2))
  }

  return { ok: true, data: items }
}
