import {
  envFirstOr,
  isRecord,
  normalizeImileToken,
  readDefaultImileHubcode,
} from './shared'
import { requestImileApi } from './client'
import { buildImilePortalHeaders, IMILE_DS_CLOSURE_PORTAL } from './portal'
import { readResultListRows, readResultObject } from './resultObject'

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
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_CLOSURE',
    defaults: IMILE_DS_CLOSURE_PORTAL,
    sharedEnvPrefixes: ['IMILE_TRACK'],
  })
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
