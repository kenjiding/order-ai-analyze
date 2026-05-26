import {
  buildImileAuthHeaders,
  envFirstOr,
  imileRequestJson,
  isRecord,
  normalizeImileToken,
  readDefaultImileHubcode,
  truncateRawText,
} from './shared'

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

type ClosureApiError = {
  ok: false
  status: number
  message: string
  rawText?: string
}

function makeClosureHeaders(token: string): Record<string, string> {
  return buildImileAuthHeaders({
    token,
    resourceCode: envFirstOr(['IMILE_CLOSURE_RESOURCE_CODE'], 'orderExceptionClosure'),
    sysName: envFirstOr(['IMILE_CLOSURE_SYS_NAME'], 'DS'),
    sysPortal: envFirstOr(['IMILE_CLOSURE_SYS_PORTAL'], 'DS'),
    origin: envFirstOr(['IMILE_CLOSURE_ORIGIN'], 'https://ds.imile.com'),
    referer: envFirstOr(['IMILE_CLOSURE_REFERER'], 'https://ds.imile.com/'),
    frontSecEnvKeys: ['IMILE_CLOSURE_FRONT_SEC', 'IMILE_TRACK_FRONT_SEC'],
    hubcodeEnvKeys: ['IMILE_CLOSURE_HUBCODE', 'IMILE_TRACK_HUBCODE'],
    langEnvKeys: ['IMILE_CLOSURE_LANG', 'IMILE_TRACK_LANG'],
    timezoneEnvKeys: ['IMILE_CLOSURE_TIMEZONE', 'IMILE_TRACK_TIMEZONE'],
    cookieEnvKeys: ['IMILE_CLOSURE_COOKIE', 'IMILE_TRACK_COOKIE'],
    extra: {
      'Content-Type': 'application/json',
    },
  })
}

function readResultObject(payload: unknown): unknown {
  if (!isRecord(payload)) return null
  return payload.resultObject
}

function readVendorRows(payload: unknown): unknown[] {
  const resultObject = readResultObject(payload)
  if (Array.isArray(resultObject)) return resultObject
  if (!isRecord(resultObject)) return []
  if (Array.isArray(resultObject.results)) return resultObject.results
  if (Array.isArray(resultObject.list)) return resultObject.list
  if (Array.isArray(resultObject.data)) return resultObject.data
  return []
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
  const res = await imileRequestJson({
    url,
    method: 'GET',
    headers: makeClosureHeaders(token),
  })

  if (!res.readOk) {
    return {
      ok: false,
      status: res.status,
      message: '供应商列表接口返回非 JSON',
      rawText: truncateRawText(res.text),
    }
  }
  if (!res.httpOk) {
    return {
      ok: false,
      status: res.status,
      message: '供应商列表接口 HTTP 错误',
      rawText: truncateRawText(res.text),
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

function buildDriverQueryPayload(input: { driverId: string; stationCode: string }): DriverQueryPayload {
  return {
    auditStatus: 'PASS',
    auditType: '',
    currentPage: 1,
    deptCode: '',
    driverCode: '',
    driverName: '',
    employeeTypeList: [],
    functional: '',
    isDtl: '',
    multiDriverCode: input.driverId,
    postCode: '',
    showCount: 20,
    showSubOrganizationEmployee: 1,
    stationCode: input.stationCode,
    status: 'ACTIVE',
    vehicleModel: '',
    vendorCode: '',
  }
}

function readDriverFirstResult(payload: unknown): Record<string, unknown> | null {
  const resultObject = readResultObject(payload)
  if (!isRecord(resultObject) || !Array.isArray(resultObject.results)) return null
  const first = resultObject.results[0]
  if (!isRecord(first)) return null
  return first
}

export async function queryDriverVendorByDriverId(input: {
  imileToken: string
  driverId: string
  stationCode: string
}): Promise<{ ok: true; result: ClosureDriverVendorResult | null } | ClosureApiError> {
  const token = normalizeImileToken(input.imileToken)
  const url = envFirstOr(
    ['IMILE_CLOSURE_DRIVER_URL'],
    'https://ds.imile.com/lm/express/base/v1/biz/driver/page'
  )
  const body = buildDriverQueryPayload({ driverId: input.driverId, stationCode: input.stationCode })
  const res = await imileRequestJson({
    url,
    method: 'POST',
    headers: makeClosureHeaders(token),
    body: JSON.stringify(body),
  })

  if (!res.readOk) {
    return {
      ok: false,
      status: res.status,
      message: '司机查询接口返回非 JSON',
      rawText: truncateRawText(res.text),
    }
  }
  if (!res.httpOk) {
    return {
      ok: false,
      status: res.status,
      message: '司机查询接口 HTTP 错误',
      rawText: truncateRawText(res.text),
    }
  }

  const first = readDriverFirstResult(res.json)
  if (!first) return { ok: true, result: null }
  const vendorCode = String(first.vendorCode ?? '').trim()
  const vendorName = String(first.vendorName ?? '').trim()
  if (!vendorCode && !vendorName) return { ok: true, result: null }
  return {
    ok: true,
    result: {
      driverId: input.driverId,
      vendorCode: vendorCode || vendorName,
      vendorName: vendorName || vendorCode,
    },
  }
}
