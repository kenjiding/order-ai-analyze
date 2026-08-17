import {
  envFirstOr,
  isRecord,
  normalizeImileToken,
  readDefaultImileHubcode,
} from './shared'
import { requestImileApi } from './client'
import { buildImilePortalHeaders, IMILE_DS_CLOSURE_PORTAL } from './portal'
import { readResultListRows, readResultObject } from './resultObject'
import { fetchPaginatedResultRows } from './paginatedQuery'

export type ClosureVendorOption = {
  key: string
  value: string
  label: string | null
}

export type ClosureDriverVendorResult = {
  driverId: string
  vendorCode: string
  vendorName: string
}

/** 司机查询命中的单条记录；按名字查询时可能命中多条，需由调用方决定取哪条。 */
export type ClosureDriverVendorMatch = {
  driverId: string
  driverName: string
  vendorCode: string
  vendorName: string
}

type ClosureApiError = {
  ok: false
  status: number
  message: string
  rawText?: string
}

const DEFAULT_CLOSE_SEARCH_URL = 'https://ds.imile.com/saastms/v1/biz/exception/close/search'
const DEFAULT_CLOSE_SEARCH_REASON = 'aus_Packet_loss_in_the_station'
const CLOSE_SEARCH_PAGE_SHOW_COUNT = 1000

function makeClosureHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_CLOSURE',
    defaults: IMILE_DS_CLOSURE_PORTAL,
    sharedEnvPrefixes: ['IMILE_TRACK'],
  })
}

type CloseSearchPayload = {
  auditStatus: 'finish'
  currentPage: number
  dateSearchType: 'end'
  end: string
  exceptionCloseReason: string
  orderCode: string
  selectAll: false
  showCount: number
  start: string
  waybillNos: string[]
}

export function buildCloseSearchPayload(input: {
  start: string
  end: string
  currentPage: number
  showCount: number
  exceptionCloseReason: string
}): CloseSearchPayload {
  return {
    auditStatus: 'finish',
    currentPage: input.currentPage,
    dateSearchType: 'end',
    end: input.end,
    exceptionCloseReason: input.exceptionCloseReason,
    orderCode: '',
    selectAll: false,
    showCount: input.showCount,
    start: input.start,
    waybillNos: [],
  }
}

export function extractClosedPacketLossWaybillNos(records: unknown[]): string[] {
  const waybillNos = new Set<string>()
  for (const row of records) {
    if (!isRecord(row)) continue
    const waybillNo = String(row.waybillNo ?? '').trim()
    if (waybillNo) waybillNos.add(waybillNo)
  }
  return [...waybillNos]
}

export async function queryClosedPacketLossWaybills(input: {
  imileToken: string
  start: string
  end: string
  exceptionCloseReason?: string
}): Promise<{ ok: true; waybillNos: string[] } | ClosureApiError> {
  const token = normalizeImileToken(input.imileToken)
  const start = String(input.start ?? '').trim()
  const end = String(input.end ?? '').trim()
  if (!start || !end) {
    return { ok: false, status: 400, message: '异常闭环查询缺少 start 或 end' }
  }
  const exceptionCloseReason = String(
    input.exceptionCloseReason ?? DEFAULT_CLOSE_SEARCH_REASON,
  ).trim()
  if (!exceptionCloseReason) {
    return { ok: false, status: 400, message: '异常闭环查询缺少 exceptionCloseReason' }
  }

  const url = envFirstOr(['IMILE_CLOSURE_SEARCH_URL'], DEFAULT_CLOSE_SEARCH_URL)
  const headers = makeClosureHeaders(token)
  const pageResult = await fetchPaginatedResultRows({
    label: '异常闭环搜索',
    pageShowCount: CLOSE_SEARCH_PAGE_SHOW_COUNT,
    buildPageBody: ({ currentPage, showCount }) =>
      buildCloseSearchPayload({
        start,
        end,
        currentPage,
        showCount,
        exceptionCloseReason,
      }),
    requestPage: (body) =>
      requestImileApi({
        url,
        method: 'POST',
        headers,
        body,
        label: '异常闭环搜索',
      }),
  })
  if (!pageResult.ok) {
    return {
      ok: false,
      status: pageResult.status,
      message: pageResult.message,
      rawText: pageResult.rawText,
    }
  }

  return { ok: true, waybillNos: extractClosedPacketLossWaybillNos(pageResult.records) }
}

function readVendorRows(payload: unknown): unknown[] {
  return readResultListRows(payload)
}

function normalizeVendorOption(raw: unknown): ClosureVendorOption | null {
  if (!isRecord(raw)) return null
  const key = String(raw.vendorCode ?? raw.code ?? raw.key ?? '').trim()
  const value = String(raw.vendorName ?? raw.name ?? raw.value ?? '').trim()
  if (!key && !value) return null
  return {
    key: key || value,
    value: value || key,
    label: null,
  }
}

export function readClosureDefaultStationCode(): string {
  return readDefaultImileHubcode()
}

export async function queryClosureVendorOptions(
  imileToken: string
): Promise<{ ok: true; vendors: ClosureVendorOption[] } | ClosureApiError> {
  const token = normalizeImileToken(imileToken)
  const url = envFirstOr(['IMILE_CLOSURE_VENDOR_URL'], 'https://ds.imile.com/hermes/vendor/getAllList')
  const res = await requestImileApi({
    url,
    method: 'GET',
    headers: makeClosureHeaders(token),
    label: '供应商列表',
    retryBusy: false,
  })

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: res.message,
      rawText: res.rawText,
    }
  }

  const vendors = readVendorRows(res.json)
    .map((row) => normalizeVendorOption(row))
    .filter((row): row is ClosureVendorOption => row !== null)
  return { ok: true, vendors }
}

type DriverQueryPayload = {
  auditStatus: 'PASS'
  auditType: string
  currentPage: number
  deptCode: string
  driverCode: string
  driverName: string
  employeeTypeList: string[]
  functional: string
  isDtl: string
  multiDriverCode: string
  postCode: string
  showCount: number
  showSubOrganizationEmployee: number
  stationCode: string
  status: 'ACTIVE'
  vehicleModel: string
  vendorCode: string
}

function buildDriverQueryPayload(input: {
  driverId?: string
  driverName?: string
  stationCode: string
}): DriverQueryPayload {
  return {
    auditStatus: 'PASS',
    auditType: '',
    currentPage: 1,
    deptCode: '',
    driverCode: '',
    driverName: input.driverName ?? '',
    employeeTypeList: [],
    functional: '',
    isDtl: '',
    multiDriverCode: input.driverId ?? '',
    postCode: '',
    showCount: 20,
    showSubOrganizationEmployee: 1,
    stationCode: input.stationCode,
    status: 'ACTIVE',
    vehicleModel: '',
    vendorCode: '',
  }
}

function readDriverResultRows(payload: unknown): Record<string, unknown>[] {
  const resultObject = readResultObject(payload)
  if (!isRecord(resultObject) || !Array.isArray(resultObject.results)) return []
  return resultObject.results.filter(isRecord)
}

function normalizeDriverMatch(raw: Record<string, unknown>): ClosureDriverVendorMatch | null {
  const vendorCode = String(raw.vendorCode ?? '').trim()
  const vendorName = String(raw.vendorName ?? '').trim()
  if (!vendorCode && !vendorName) return null
  return {
    driverId: String(raw.driverCode ?? raw.driverId ?? '').trim(),
    driverName: String(raw.driverName ?? '').trim(),
    vendorCode: vendorCode || vendorName,
    vendorName: vendorName || vendorCode,
  }
}

/** iMile 按 driverName 查询可能是模糊匹配，需要用输入值精确回筛，避免把同前缀的其他司机当成命中。 */
function pickExactDriverMatch(
  matches: ClosureDriverVendorMatch[],
  keyword: string
): ClosureDriverVendorMatch | null {
  const needle = keyword.trim().toLowerCase()
  if (!needle) return null
  return (
    matches.find(
      (m) => m.driverId.toLowerCase() === needle || m.driverName.toLowerCase() === needle
    ) ?? null
  )
}

export type ClosureExceptionAddInput = {
  imileToken: string
  waybillNo: string
  exceptionCloseReason: string
  exceptionHandleRemark: string
  vendorCode: string
  violence: '0' | '1'
}

export async function addClosureException(
  input: ClosureExceptionAddInput
): Promise<{ ok: true } | ClosureApiError> {
  const token = normalizeImileToken(input.imileToken)
  const url = envFirstOr(
    ['IMILE_CLOSURE_ADD_URL'],
    'https://ds.imile.com/saastms/v1/biz/exception/close/add'
  )
  const body = {
    attachmentFileList: [],
    chargebackList: [],
    exceptionCloseReason: input.exceptionCloseReason,
    exceptionHandleRemark: input.exceptionHandleRemark,
    vendorCode: input.vendorCode,
    violence: input.violence,
    waybillNo: input.waybillNo,
  }
  const res = await requestImileApi({
    url,
    method: 'POST',
    headers: makeClosureHeaders(token),
    body,
    label: '异常完结新增',
    retryBusy: false,
  })

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: res.message,
      rawText: res.rawText,
    }
  }

  return { ok: true }
}

/**
 * 司机供应商查询。driverId 走 multiDriverCode，driverName 走 driverName（轨迹「分配」事件只有名字没有 ID）。
 * 返回全部候选与精确匹配项，由调用方决定在多条命中时是取值还是标注不确定。
 */
export async function queryDriverVendor(input: {
  imileToken: string
  driverId?: string
  driverName?: string
  stationCode: string
}): Promise<
  { ok: true; matches: ClosureDriverVendorMatch[]; exact: ClosureDriverVendorMatch | null } | ClosureApiError
> {
  const token = normalizeImileToken(input.imileToken)
  const url = envFirstOr(
    ['IMILE_CLOSURE_DRIVER_URL'],
    'https://ds.imile.com/lm/express/base/v1/biz/driver/page'
  )
  const body = buildDriverQueryPayload({
    driverId: input.driverId,
    driverName: input.driverName,
    stationCode: input.stationCode,
  })
  const res = await requestImileApi({
    url,
    method: 'POST',
    headers: makeClosureHeaders(token),
    body,
    label: '司机查询',
    retryBusy: false,
  })

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: res.message,
      rawText: res.rawText,
    }
  }

  const matches = readDriverResultRows(res.json)
    .map(normalizeDriverMatch)
    .filter((m): m is ClosureDriverVendorMatch => m !== null)
  const keyword = String(input.driverId ?? input.driverName ?? '')
  return { ok: true, matches, exact: pickExactDriverMatch(matches, keyword) }
}

export async function queryDriverVendorByDriverId(input: {
  imileToken: string
  driverId: string
  stationCode: string
}): Promise<{ ok: true; result: ClosureDriverVendorResult | null } | ClosureApiError> {
  const res = await queryDriverVendor({
    imileToken: input.imileToken,
    driverId: input.driverId,
    stationCode: input.stationCode,
  })
  if (!res.ok) return res

  // 保持既有调用方（异常完结抽屉自动回填供应商）的行为不变：始终取第一条命中。
  const first = res.matches[0]
  if (!first) return { ok: true, result: null }
  return {
    ok: true,
    result: {
      driverId: input.driverId,
      vendorCode: first.vendorCode,
      vendorName: first.vendorName,
    },
  }
}
