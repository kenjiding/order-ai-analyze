import {
  isRecord,
  mergeBatchRaw,
  normalizeImileToken,
} from './shared'
import { requestImileApi } from './client'
import { buildImilePortalHeaders, IMILE_OC_INTERCEPT_PORTAL } from './portal'
import { mapWithConcurrency } from '../orderAnalyze/runtime'
import { isConfiguredNonRealOrSystemOperator } from '../orderAnalyze/warehouseProfiles'

function readImileInterceptFetchConcurrency(): number {
  const raw = Number.parseInt(String(process.env.IMILE_INTERCEPT_FETCH_CONCURRENCY ?? ''), 10)
  if (!Number.isFinite(raw)) return 6
  if (raw < 1) return 1
  if (raw > 12) return 12
  return raw
}

const DEFAULT_INTERCEPT_LOG_URL = 'https://oc.imile.com/logcenter/bizLog/listScanInterceptLogs'

export type InterceptOperatorType = 'courier' | 'scanner' | 'unknown'

export type ScanInterceptLog = {
  waybillNo: string
  gmtScan?: string
  scanTypeDesc?: string
  scanOcName?: string
  interceptReasonDesc?: string
  scanUserCode: string
  scanUserName: string
  gmtIntercept: string
  operatorType: InterceptOperatorType
}

export type ScanInterceptQuerySuccess = {
  ok: true
  interceptLogs: Record<string, ScanInterceptLog[]>
  raw: unknown
  errors: { orderNo: string; message: string }[]
}

export type ScanInterceptQueryError = {
  ok: false
  status: number
  message: string
  rawText?: string
  interceptLogs: Record<string, ScanInterceptLog[]>
  errors: { orderNo: string; message: string }[]
}

function classifyInterceptOperator(scanUserCode: string, scanUserName: string): InterceptOperatorType {
  if (scanUserCode.startsWith('D')) return 'courier'
  // 阻断日志没有仓库上下文，只排除仓库画像中的系统/非真实账号。
  if (/^\d+$/.test(scanUserCode) && scanUserName && !isConfiguredNonRealOrSystemOperator(scanUserName))
    return 'scanner'
  return 'unknown'
}

function buildInterceptHeaders(imileToken: string): Record<string, string> {
  return buildImilePortalHeaders({
    token: imileToken,
    envPrefix: 'IMILE_INTERCEPT',
    defaults: IMILE_OC_INTERCEPT_PORTAL,
    sharedEnvPrefixes: ['IMILE_TRACK'],
  })
}

function buildInterceptUrl(waybillNo: string): string {
  const baseUrl = process.env.IMILE_INTERCEPT_LOG_URL ?? DEFAULT_INTERCEPT_LOG_URL
  const url = new URL(baseUrl)
  url.searchParams.set('waybillNo', waybillNo)
  return url.toString()
}

function normalizeInterceptLog(row: Record<string, unknown>, fallbackWaybillNo: string): ScanInterceptLog | null {
  const scanUserCode = String(row.scanUserCode ?? '').trim()
  const scanUserName = String(row.scanUserName ?? '').trim()
  const gmtScan = String(row.gmtScan ?? row.gmtIntercept ?? '').trim()
  const scanTypeDesc = String(row.scanTypeDesc ?? '').trim()
  const scanOcName = String(row.scanOcName ?? '').trim()
  const interceptReasonDesc = String(row.interceptReasonDesc ?? '').trim()
  const gmtIntercept = String(row.gmtIntercept ?? '').trim()
  if (!scanUserCode || !gmtScan) return null
  if (scanUserCode.toLowerCase() === 'cornerstone') return null

  return {
    waybillNo: String(row.waybillNo ?? row.orderNo ?? fallbackWaybillNo).trim() || fallbackWaybillNo,
    gmtScan,
    scanTypeDesc,
    scanOcName,
    interceptReasonDesc,
    scanUserCode,
    scanUserName,
    gmtIntercept: gmtIntercept || gmtScan,
    operatorType: classifyInterceptOperator(scanUserCode, scanUserName),
  }
}

/** resultObject 即阻断日志列表（数组）；兼容单笔对象。 */
export function extractInterceptLogs(resultObject: unknown, fallbackWaybillNo: string): ScanInterceptLog[] {
  const rows = Array.isArray(resultObject)
    ? resultObject.filter(isRecord)
    : isRecord(resultObject)
      ? [resultObject]
      : []

  return rows
    .map((row) => normalizeInterceptLog(row, fallbackWaybillNo))
    .filter((row): row is ScanInterceptLog => row !== null)
}

async function queryOneInterceptLog(
  imileToken: string,
  orderNo: string
): Promise<{ ok: true; logs: ScanInterceptLog[]; raw: unknown } | { ok: false; status: number; message: string; rawText?: string }> {
  const res = await requestImileApi({
    url: buildInterceptUrl(orderNo),
    method: 'GET',
    headers: buildInterceptHeaders(imileToken),
    label: `阻断日志（运单 ${orderNo}）`,
  })

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: res.message,
      rawText: res.rawText,
    }
  }

  const resultObject = isRecord(res.json) ? res.json.resultObject : null
  return { ok: true, logs: extractInterceptLogs(resultObject, orderNo), raw: res.json }
}

export async function queryImileScanInterceptLogs(
  imileToken: string,
  orderNos: string[]
): Promise<ScanInterceptQuerySuccess | ScanInterceptQueryError> {
  const token = normalizeImileToken(imileToken)
  const dedupedOrderNos = Array.from(new Set(orderNos))
  const interceptLogs: Record<string, ScanInterceptLog[]> = {}
  const raws: unknown[] = []
  const errors: { orderNo: string; message: string }[] = []
  let firstError: { status: number; message: string; rawText?: string } | null = null

  const concurrency = readImileInterceptFetchConcurrency()
  const perOrderResults = await mapWithConcurrency(dedupedOrderNos, concurrency, async (orderNo) => {
    const result = await queryOneInterceptLog(token, orderNo)
    return { orderNo, result }
  })

  for (const { orderNo, result } of perOrderResults) {
    if (!result.ok) {
      errors.push({ orderNo, message: result.message })
      if (!firstError) {
        firstError = {
          status: result.status,
          message: result.message,
          rawText: result.rawText,
        }
      }
      interceptLogs[orderNo] = []
      continue
    }

    interceptLogs[orderNo] = result.logs
    raws.push({ orderNo, response: result.raw })
  }

  if (firstError && raws.length === 0) {
    return {
      ok: false,
      status: firstError.status,
      message: firstError.message,
      rawText: firstError.rawText,
      interceptLogs,
      errors,
    }
  }

  return {
    ok: true,
    interceptLogs,
    raw: mergeBatchRaw(raws),
    errors,
  }
}
