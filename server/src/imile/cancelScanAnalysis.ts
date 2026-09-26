/**
 * 取消扫描分析：先拉取消扫描报表，再按运单号查运单信息并统计路由码分布。
 */

import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DS_SAAS_TMS_PORTAL } from './portal'
import { envFirstOr, IMILE_DEFAULT_HUBCODE, isRecord, mergeBatchRaw, normalizeImileToken, sleep } from './shared'

const DEFAULT_CANCEL_SCAN_URL =
  'https://ds.imile.com/saastms/v1/report/cancelScan/queryCancelScanResultDTO'
const DEFAULT_SEARCH_WAYBILL_URL =
  'https://ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'

const CANCEL_SCAN_PAGE_SHOW_COUNT = 500
const WAYBILL_PAGE_SHOW_COUNT = 500
const WAYBILL_BATCH_SIZE = 100
const PAGE_DELAY_MS = 400
const BATCH_DELAY_MS = 400

const CANCEL_SCAN_TYPE = '1504'

/**
 * 取消扫描报表（scanType=1504）里真正算「分错」的记录：响应里 record.scanType 文本字段。
 * 实测该站点该分类下记录的 scanType 恒为「取消分配派件员」（不是「取消司机取件限制」——
 * 那是 cancelScanReclassify.ts 里另一个按订单号查、不限分类的场景专用的文本，两者是不同的取消原因）。
 */
export const MISASSIGNED_COURIER_SCAN_TYPE = '取消分配派件员'

export type CancelScanAnalysisSuccess = {
  ok: true
  cancelScanRecords: unknown[]
  cancelScanTotal: number
  waybillNos: string[]
  waybillRecords: unknown[]
  routeCodeDistribution: Array<{ routeCode: string; count: number }>
  dailyRouteCodeCounts: Array<{ date: string; routeCode: string; count: number }>
  raw: {
    cancelScan: unknown
    searchWaybill: unknown
  }
}

export type CancelScanAnalysisError = {
  ok: false
  status: number
  message: string
  rawText?: string
}

function makeSaasTmsHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_CANCEL_SCAN',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_TRACK'],
    injectUserCode: true,
    // 取消扫描 / 运单查询固定 hubcode，不受站点选择器覆盖
    overrides: { hubcode: IMILE_DEFAULT_HUBCODE },
  })
}

function buildCancelScanBody(input: {
  scanStationCode: string
  scanStartTime: string
  scanEndTime: string
  currentPage: number
  showCount: number
}): Record<string, unknown> {
  return {
    cancelReason: '',
    currentPage: input.currentPage,
    operateUserCode: '',
    scanEndTime: input.scanEndTime,
    scanNumbers: [] as string[],
    scanStartTime: input.scanStartTime,
    scanStationCode: input.scanStationCode,
    scanType: CANCEL_SCAN_TYPE,
    showCount: input.showCount,
  }
}

/** 按订单号（scanNumbers）精确查询取消扫描记录，不限定 scanType，用于订单异常复核。 */
function buildCancelScanByScanNumbersBody(input: {
  scanNumbers: string[]
  scanStationCode: string
  currentPage: number
  showCount: number
}): Record<string, unknown> {
  return {
    cancelReason: '',
    currentPage: input.currentPage,
    operateUserCode: '',
    scanNumbers: input.scanNumbers,
    scanStationCode: input.scanStationCode,
    scanType: '',
    showCount: input.showCount,
  }
}

function buildSearchWaybillBody(input: {
  startTime: string
  endTime: string
  waybillNos: string[]
  currentPage: number
  showCount: number
}): Record<string, unknown> {
  return {
    actualReceiveStation: '',
    currentPage: input.currentPage,
    dateSearchType: 'waybill',
    endTime: input.endTime,
    labelOrderCodes: [] as string[],
    mainWaybillNos: [] as string[],
    platformNos: [] as string[],
    referenceNos: [] as string[],
    showCount: input.showCount,
    startTime: input.startTime,
    waybillNos: input.waybillNos,
  }
}

function isMisassignedCourierRecord(record: unknown): boolean {
  if (!isRecord(record)) return false
  return String(record.scanType ?? '').trim() === MISASSIGNED_COURIER_SCAN_TYPE
}

/** 调试用：统计原始记录里 scanType 文本的分布，帮助核对「过滤后为 0 条」是数据本身没有还是字段/参数不对。 */
function summarizeScanTypes(records: unknown[]): string {
  const counts = new Map<string, number>()
  for (const record of records) {
    const key = isRecord(record) ? String(record.scanType ?? '(无 scanType 字段)') : '(非对象记录)'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (!counts.size) return '(无记录)'
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}=${count}`)
    .join(', ')
}

function readScanNumber(record: unknown): string {
  if (!isRecord(record)) return ''
  return String(record.scanNumber ?? record.waybillNo ?? '').trim()
}

/** 取消扫描接口 resultObject.results[].scanDate → YYYY-MM-DD */
function readCancelScanDateKey(record: unknown): string | null {
  if (!isRecord(record)) return null
  const raw = String(record.scanDate ?? '').trim()
  if (!raw) return null

  const isoPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoPrefix) return isoPrefix[1]

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (slashMatch) {
    const [, d, m, y] = slashMatch
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`
  }

  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) {
    const dt = new Date(parsed)
    const y = dt.getFullYear()
    const m = String(dt.getMonth() + 1).padStart(2, '0')
    const d = String(dt.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  return null
}

function buildWaybillRouteCodeMap(records: unknown[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const record of records) {
    if (!isRecord(record)) continue
    const waybillNo = String(record.waybillNo ?? record.waybillNumber ?? record.mainWaybillNo ?? '').trim()
    if (!waybillNo) continue
    const routeCode = String(record.consigneeRouteCode ?? '').trim() || '(空)'
    map.set(waybillNo, routeCode)
  }
  return map
}

function buildDailyRouteCodeCounts(input: {
  cancelScanRecords: unknown[]
  waybillRouteMap: Map<string, string>
}): Array<{ date: string; routeCode: string; count: number }> {
  const counts = new Map<string, number>()
  for (const record of input.cancelScanRecords) {
    const date = readCancelScanDateKey(record)
    const waybillNo = readScanNumber(record)
    if (!date || !waybillNo) continue
    const routeCode = input.waybillRouteMap.get(waybillNo) ?? '(空)'
    const key = `${date}\0${routeCode}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([key, count]) => {
      const [date, routeCode] = key.split('\0')
      return { date, routeCode, count }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || b.count - a.count || a.routeCode.localeCompare(b.routeCode))
}

function collectUniqueWaybillNos(records: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const record of records) {
    const no = readScanNumber(record)
    if (!no || seen.has(no)) continue
    seen.add(no)
    out.push(no)
  }
  return out
}

function countRouteCodeDistribution(records: unknown[]): Array<{ routeCode: string; count: number }> {
  const counts = new Map<string, number>()
  for (const record of records) {
    if (!isRecord(record)) continue
    const code = String(record.consigneeRouteCode ?? '').trim() || '(空)'
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([routeCode, count]) => ({ routeCode, count }))
    .sort((a, b) => b.count - a.count || a.routeCode.localeCompare(b.routeCode))
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

async function fetchWaybillsByNos(input: {
  headers: Record<string, string>
  url: string
  startTime: string
  endTime: string
  waybillNos: string[]
}): Promise<{ ok: true; records: unknown[]; raw: unknown } | CancelScanAnalysisError> {
  const batches = chunkArray(input.waybillNos, WAYBILL_BATCH_SIZE)
  const allRecords: unknown[] = []
  const raws: unknown[] = []

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]
    const result = await fetchPaginatedResultRows({
      label: '运单信息查询',
      pageShowCount: WAYBILL_PAGE_SHOW_COUNT,
      pageDelayMs: PAGE_DELAY_MS,
      buildPageBody: ({ currentPage, showCount }) =>
        buildSearchWaybillBody({
          startTime: input.startTime,
          endTime: input.endTime,
          waybillNos: batch,
          currentPage,
          showCount,
        }),
      requestPage: (body) =>
        requestImileApi({
          url: input.url,
          method: 'POST',
          headers: input.headers,
          body,
          label: '运单信息查询',
        }),
    })

    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        message: result.message,
        rawText: result.rawText,
      }
    }

    raws.push(result.raw)
    allRecords.push(...result.records)

    if (i < batches.length - 1) await sleep(BATCH_DELAY_MS)
  }

  return {
    ok: true,
    records: allRecords,
    raw: mergeBatchRaw(raws),
  }
}

export type CancelScanRecordsByScanNumbersSuccess = {
  ok: true
  records: unknown[]
  raw: unknown
}

export type CancelScanRecordsByScanNumbersError = CancelScanAnalysisError

/**
 * 按订单号（scanNumbers）批量查询取消扫描记录，用于订单异常「库外丢失」二次核验：
 * 若库内真实扫描员在责任转出库外之后又执行了「取消司机取件限制」，说明包裹实际仍由库内处理。
 */
export async function queryCancelScanRecordsByScanNumbers(input: {
  imileToken: string
  scanNumbers: string[]
  scanStationCode?: string
}): Promise<CancelScanRecordsByScanNumbersSuccess | CancelScanRecordsByScanNumbersError> {
  const token = normalizeImileToken(input.imileToken)
  const cancelScanUrl = envFirstOr(['IMILE_CANCEL_SCAN_URL'], DEFAULT_CANCEL_SCAN_URL)
  const headers = makeSaasTmsHeaders(token)
  const scanStationCode =
    input.scanStationCode?.trim() ||
    envFirstOr(['IMILE_CANCEL_SCAN_STATION_CODE'], IMILE_DEFAULT_HUBCODE)

  const uniqueScanNumbers = Array.from(
    new Set(input.scanNumbers.map((no) => String(no).trim()).filter(Boolean))
  )
  if (!uniqueScanNumbers.length) {
    return { ok: true, records: [], raw: null }
  }

  const batches = chunkArray(uniqueScanNumbers, WAYBILL_BATCH_SIZE)
  const allRecords: unknown[] = []
  const raws: unknown[] = []

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]
    const result = await fetchPaginatedResultRows({
      label: '取消扫描查询（按订单号）',
      pageShowCount: CANCEL_SCAN_PAGE_SHOW_COUNT,
      pageDelayMs: PAGE_DELAY_MS,
      buildPageBody: ({ currentPage, showCount }) =>
        buildCancelScanByScanNumbersBody({
          scanNumbers: batch,
          scanStationCode,
          currentPage,
          showCount,
        }),
      requestPage: (body) =>
        requestImileApi({
          url: cancelScanUrl,
          method: 'POST',
          headers,
          body,
          label: '取消扫描查询（按订单号）',
        }),
    })

    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        message: result.message,
        rawText: result.rawText,
      }
    }

    raws.push(result.raw)
    allRecords.push(...result.records)

    if (i < batches.length - 1) await sleep(BATCH_DELAY_MS)
  }

  return {
    ok: true,
    records: allRecords,
    raw: mergeBatchRaw(raws),
  }
}

export async function analyzeCancelScan(input: {
  imileToken: string
  startTime: string
  endTime: string
  scanStationCode?: string
}): Promise<CancelScanAnalysisSuccess | CancelScanAnalysisError> {
  const token = normalizeImileToken(input.imileToken)
  const cancelScanUrl = envFirstOr(['IMILE_CANCEL_SCAN_URL'], DEFAULT_CANCEL_SCAN_URL)
  const searchWaybillUrl = envFirstOr(['IMILE_SEARCH_WAYBILL_URL'], DEFAULT_SEARCH_WAYBILL_URL)
  const headers = makeSaasTmsHeaders(token)
  const scanStationCode =
    input.scanStationCode?.trim() ||
    envFirstOr(['IMILE_CANCEL_SCAN_STATION_CODE'], IMILE_DEFAULT_HUBCODE)

  const cancelScanResult = await fetchPaginatedResultRows({
    label: '取消扫描查询',
    pageShowCount: CANCEL_SCAN_PAGE_SHOW_COUNT,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) =>
      buildCancelScanBody({
        scanStationCode,
        scanStartTime: input.startTime,
        scanEndTime: input.endTime,
        currentPage,
        showCount,
      }),
    requestPage: (body) =>
      requestImileApi({
        url: cancelScanUrl,
        method: 'POST',
        headers,
        body,
        label: '取消扫描查询',
      }),
  })

  if (!cancelScanResult.ok) {
    return {
      ok: false,
      status: cancelScanResult.status,
      message: cancelScanResult.message,
      rawText: cancelScanResult.rawText,
    }
  }

  console.log(
    `[cancel-scan-analysis] scanStationCode=${scanStationCode} startTime=${input.startTime} endTime=${input.endTime} 原始记录 scanType 分布: ${summarizeScanTypes(cancelScanResult.records)}`,
  )

  // 报表内只有 scanType=「取消分配派件员」的记录才算分错，其余取消扫描原因不计入。
  const cancelScanRecords = cancelScanResult.records.filter(isMisassignedCourierRecord)
  const waybillNos = collectUniqueWaybillNos(cancelScanRecords)

  if (!waybillNos.length) {
    return {
      ok: true,
      cancelScanRecords,
      cancelScanTotal: cancelScanResult.totalResult,
      waybillNos: [],
      waybillRecords: [],
      routeCodeDistribution: [],
      dailyRouteCodeCounts: [],
      raw: {
        cancelScan: cancelScanResult.raw,
        searchWaybill: null,
      },
    }
  }

  const waybillResult = await fetchWaybillsByNos({
    headers,
    url: searchWaybillUrl,
    startTime: input.startTime,
    endTime: input.endTime,
    waybillNos,
  })

  if (!waybillResult.ok) {
    return waybillResult
  }

  const waybillRouteMap = buildWaybillRouteCodeMap(waybillResult.records)
  const dailyRouteCodeCounts = buildDailyRouteCodeCounts({
    cancelScanRecords,
    waybillRouteMap,
  })

  return {
    ok: true,
    cancelScanRecords,
    cancelScanTotal: cancelScanResult.totalResult,
    waybillNos,
    waybillRecords: waybillResult.records,
    routeCodeDistribution: countRouteCodeDistribution(waybillResult.records),
    dailyRouteCodeCounts,
    raw: {
      cancelScan: cancelScanResult.raw,
      searchWaybill: waybillResult.raw,
    },
  }
}
