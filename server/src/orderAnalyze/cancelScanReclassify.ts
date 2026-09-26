/**
 * 「库外丢失」二次核验：库内真实扫描员若在责任转出库外之后，
 * 又对同一订单执行了「取消司机取件限制」（operationResourceCode=2），
 * 说明包裹实际仍由库内扫描员处理，应改判为「库内丢失」。
 *
 * 与 decisionRules.ts 的事实校验规则同源但独立：后者仅依赖轨迹/阻断日志（同步、确定性），
 * 本模块依赖外部取消扫描接口（异步 I/O），因此作为 runOrderAnalyzePipeline 之后的独立复核阶段运行。
 */

import { queryCancelScanRecordsByScanNumbers } from '../imile/cancelScanAnalysis'
import { isRecord } from '../imile/shared'
import type { OrderAnalyzeResult, TrackFacts } from './types'

const DRIVER_PICKUP_RESTRICTION_SCAN_TYPE = '取消司机取件限制'
/** operationResourceCode=2 表示库内真实扫描员操作（非司机/系统账号）。 */
const REAL_SCANNER_OPERATION_RESOURCE_CODE = '2'

export type CancelScanReclassifyMeta = {
  /** 参与复核的「库外丢失」订单号 */
  checkedOrderNos: string[]
  /** 命中改判为「库内丢失」的订单号 */
  reclassifiedOrderNos: string[]
  /** 取消扫描接口调用失败时的错误信息；存在时表示本次未完成核验，结果维持原判 */
  error?: string
}

export type QueryCancelScanRecordsFn = typeof queryCancelScanRecordsByScanNumbers

/** 「库外丢失」订单的责任转出库外起算时间；两条判定路径分别对应 finalResponsibilityStartTime 与 lastDispatchedOutTime。 */
export function resolveOutWarehouseResponsibilityStartTime(facts: TrackFacts | undefined): string | null {
  if (!facts) return null
  if (facts.finalResponsibilityOwner === 'out_warehouse' && facts.finalResponsibilityStartTime) {
    return facts.finalResponsibilityStartTime
  }
  return facts.lastDispatchedOutTime
}

/** 解析 iMile 接口返回的时间字符串为可比较的时间戳；兼容 ISO 与 d/m/yyyy 两种格式。 */
export function parseCancelScanTimestamp(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (isoMatch) {
    const [, y, mo, d, hh = '00', mi = '00', ss = '00'] = isoMatch
    const t = new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}`).getTime()
    return Number.isFinite(t) ? t : null
  }

  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (slashMatch) {
    const [, d, mo, y, hh = '00', mi = '00', ss = '00'] = slashMatch
    const t = new Date(
      `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${hh.padStart(2, '0')}:${mi.padStart(2, '0')}:${ss.padStart(2, '0')}`
    ).getTime()
    return Number.isFinite(t) ? t : null
  }

  const parsed = Date.parse(s)
  return Number.isFinite(parsed) ? parsed : null
}

function readScanNumberField(record: unknown): string {
  if (!isRecord(record)) return ''
  return String(record.scanNumber ?? record.waybillNo ?? '').trim()
}

function isRealScannerCancelledDriverPickupRestriction(record: unknown): boolean {
  if (!isRecord(record)) return false
  const resourceCode = String(record.operationResourceCode ?? '').trim()
  const scanType = String(record.scanType ?? '').trim()
  return resourceCode === REAL_SCANNER_OPERATION_RESOURCE_CODE && scanType === DRIVER_PICKUP_RESTRICTION_SCAN_TYPE
}

export type MatchingScanRecord = {
  timestamp: number
  /** 原始 scanDate 字符串，用于展示；避免用 Date 反格式化引入时区转换偏差 */
  raw: string
}

/** 同一订单可能有多条命中记录，取最新（最大）scanDate 用于比较与展示。 */
export function pickLatestMatchingScan(records: unknown[]): MatchingScanRecord | null {
  let latest: MatchingScanRecord | null = null
  for (const record of records) {
    if (!isRealScannerCancelledDriverPickupRestriction(record)) continue
    if (!isRecord(record)) continue
    const raw = String(record.scanDate ?? '').trim()
    const timestamp = parseCancelScanTimestamp(raw)
    if (timestamp === null) continue
    if (latest === null || timestamp > latest.timestamp) latest = { timestamp, raw }
  }
  return latest
}

function groupRecordsByOrderNo(records: unknown[]): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>()
  for (const record of records) {
    const orderNo = readScanNumberField(record)
    if (!orderNo) continue
    const list = map.get(orderNo)
    if (list) list.push(record)
    else map.set(orderNo, [record])
  }
  return map
}

export async function reclassifyOutWarehouseLossWithCancelScan(input: {
  results: OrderAnalyzeResult[]
  trackFacts: Record<string, TrackFacts>
  imileToken: string
  scanStationCode?: string
  queryRecords?: QueryCancelScanRecordsFn
}): Promise<{ results: OrderAnalyzeResult[]; meta: CancelScanReclassifyMeta }> {
  const queryRecords = input.queryRecords ?? queryCancelScanRecordsByScanNumbers
  const outWarehouseOrderNos = input.results
    .filter((r) => r.lossScope === '库外丢失')
    .map((r) => r.orderNo)

  if (!outWarehouseOrderNos.length) {
    return { results: input.results, meta: { checkedOrderNos: [], reclassifiedOrderNos: [] } }
  }

  const queryResult = await queryRecords({
    imileToken: input.imileToken,
    scanNumbers: outWarehouseOrderNos,
    scanStationCode: input.scanStationCode,
  })

  if (!queryResult.ok) {
    console.error(`[cancel-scan-reclassify] 取消扫描核验查询失败: ${queryResult.message}`)
    return {
      results: input.results,
      meta: {
        checkedOrderNos: outWarehouseOrderNos,
        reclassifiedOrderNos: [],
        error: queryResult.message,
      },
    }
  }

  const recordsByOrderNo = groupRecordsByOrderNo(queryResult.records)
  const reclassifiedOrderNos: string[] = []

  const results = input.results.map((result) => {
    if (result.lossScope !== '库外丢失') return result

    const facts = input.trackFacts[result.orderNo]
    const responsibilityStartTime = resolveOutWarehouseResponsibilityStartTime(facts)
    const responsibilityStartTs = parseCancelScanTimestamp(responsibilityStartTime)
    if (responsibilityStartTs === null) return result

    const records = recordsByOrderNo.get(result.orderNo) ?? []
    const latestMatch = pickLatestMatchingScan(records)
    if (!latestMatch || latestMatch.timestamp <= responsibilityStartTs) return result

    reclassifiedOrderNos.push(result.orderNo)
    const hit = `取消扫描记录显示，库内扫描员在 ${latestMatch.raw} 执行「${DRIVER_PICKUP_RESTRICTION_SCAN_TYPE}」，晚于当前库外责任起算时间 ${responsibilityStartTime}，说明包裹实际仍由库内扫描员处理`
    return {
      ...result,
      lossScope: '库内丢失' as const,
      exceptionCategoryId: '扫描员丢失',
      confidence: Math.max(0.85, result.confidence),
      needsReview: false,
      factGuardrailHit: hit,
      appliedDecisionRuleId: 'cancel_scan_driver_pickup_restriction_reassigns_in_warehouse',
      reason: `[取消扫描核验纠正] ${hit}。原始判断: ${result.reason}`,
      currentResponsibilityParty: facts?.activeWarehouseName ?? '未知仓库',
      activeResponsibilityOwner: 'company_warehouse' as const,
      latestResponsibility: null,
    }
  })

  return {
    results,
    meta: { checkedOrderNos: outWarehouseOrderNos, reclassifiedOrderNos },
  }
}
