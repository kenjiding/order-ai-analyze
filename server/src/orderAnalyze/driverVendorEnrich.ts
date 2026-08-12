/**
 * 「库内丢失/疑似派件员窃取」额外数据富化：把该子类型的首个嫌疑派件员及其所属供应商
 * 附加到分析结果的 extraData 上，供追责使用。
 *
 * 与 cancelScanReclassify.ts 同一范式：依赖外部 iMile 接口（异步 I/O），因此作为
 * runOrderAnalyzePipeline 之后的独立阶段运行。
 *
 * ⚠️ 本阶段只做「附加信息」，任何分支都不得修改 lossScope / exceptionCategoryId /
 * reason / confidence / needsReview / latestResponsibility —— 外部接口的可用性
 * 绝不能影响异常判定结论。
 */

import { queryDriverVendor, readClosureDefaultStationCode } from '../imile/closure'
import type { OrderAnalyzeExtraDataEntry, OrderAnalyzeResult, TrackFacts } from './types'

const THEFT_SUB_TYPE = '疑似派件员窃取'
/** 单批并发上限：单次分析最多 500 单，需限流避免打爆 iMile 司机查询接口。 */
const QUERY_CONCURRENCY = 4

export type QueryDriverVendorFn = typeof queryDriverVendor

export type DriverVendorEnrichMeta = {
  /** 参与富化的「疑似派件员窃取」订单号 */
  checkedOrderNos: string[]
  /** 成功补齐供应商的订单号 */
  enrichedOrderNos: string[]
  /** 按名字匹配到多条、未能确认供应商的订单号 */
  ambiguousOrderNos: string[]
  /** 司机查询失败的错误信息；存在时表示部分订单的供应商未查到，判定结论不受影响 */
  errors: string[]
}

type DriverLookup =
  | { kind: 'resolved'; vendorCode: string; vendorName: string; driverId: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'notFound' }
  | { kind: 'failed'; message: string }

function formatVendorEntryValue(lookup: DriverLookup): string {
  switch (lookup.kind) {
    case 'resolved':
      return lookup.vendorCode && lookup.vendorCode !== lookup.vendorName
        ? `${lookup.vendorName} (${lookup.vendorCode})`
        : lookup.vendorName
    case 'ambiguous':
      return `按名字匹配到 ${lookup.candidates.length} 条，未确认：${lookup.candidates.join(' / ')}`
    case 'notFound':
      return '未查询到该派件员'
    case 'failed':
      return `查询失败：${lookup.message}`
  }
}

function buildExtraData(
  driver: NonNullable<TrackFacts['firstAssignCancelDriver']>,
  lookup: DriverLookup
): OrderAnalyzeResult['extraData'] {
  const vendorText = formatVendorEntryValue(lookup)
  const entries: OrderAnalyzeExtraDataEntry[] = [
    { label: '首个嫌疑派件员', value: driver.driverName },
    { label: '首次分配时间', value: driver.assignTime },
    { label: '对应取消时间', value: driver.cancelTime },
    { label: '司机ID', value: (lookup.kind === 'resolved' ? lookup.driverId : driver.driverId) || '—' },
    { label: '所属供应商', value: vendorText },
  ]
  return {
    summary: `首个嫌疑派件员：${driver.driverName}｜供应商：${vendorText}`,
    entries,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

export async function enrichTheftSuspectDriverVendor(input: {
  results: OrderAnalyzeResult[]
  trackFacts: Record<string, TrackFacts>
  imileToken: string
  scanStationCode?: string
  queryDriverVendor?: QueryDriverVendorFn
}): Promise<{ results: OrderAnalyzeResult[]; meta: DriverVendorEnrichMeta }> {
  const emptyMeta: DriverVendorEnrichMeta = {
    checkedOrderNos: [],
    enrichedOrderNos: [],
    ambiguousOrderNos: [],
    errors: [],
  }

  const targets = input.results.filter(
    (r) =>
      r.lossScope === '库内丢失' &&
      r.exceptionCategoryId === THEFT_SUB_TYPE &&
      input.trackFacts[r.orderNo]?.firstAssignCancelDriver != null
  )
  // 无 token 时（回归运行、单测）直接跳过，不产生任何网络依赖
  if (!targets.length || !input.imileToken.trim()) {
    return { results: input.results, meta: emptyMeta }
  }

  const query = input.queryDriverVendor ?? queryDriverVendor
  const stationCode = input.scanStationCode?.trim() || readClosureDefaultStationCode()
  const meta: DriverVendorEnrichMeta = {
    checkedOrderNos: targets.map((r) => r.orderNo),
    enrichedOrderNos: [],
    ambiguousOrderNos: [],
    errors: [],
  }

  try {
    // 同一批里同一司机只查一次：一个仓库的循环常反复分配给同几个人
    const cache = new Map<string, DriverLookup>()
    const pending = new Map<string, NonNullable<TrackFacts['firstAssignCancelDriver']>>()
    for (const result of targets) {
      const driver = input.trackFacts[result.orderNo]!.firstAssignCancelDriver!
      const key = driver.driverId || driver.driverName
      if (!pending.has(key)) pending.set(key, driver)
    }

    const keys = [...pending.keys()]
    const lookups = await mapWithConcurrency(keys, QUERY_CONCURRENCY, async (key) => {
      const driver = pending.get(key)!
      const res = await query(
        driver.driverId
          ? { imileToken: input.imileToken, driverId: driver.driverId, stationCode }
          : { imileToken: input.imileToken, driverName: driver.driverName, stationCode }
      )
      if (!res.ok) return { kind: 'failed', message: res.message } satisfies DriverLookup
      if (res.exact) {
        return {
          kind: 'resolved',
          vendorCode: res.exact.vendorCode,
          vendorName: res.exact.vendorName,
          driverId: res.exact.driverId,
        } satisfies DriverLookup
      }
      if (res.matches.length === 1) {
        const only = res.matches[0]
        return {
          kind: 'resolved',
          vendorCode: only.vendorCode,
          vendorName: only.vendorName,
          driverId: only.driverId,
        } satisfies DriverLookup
      }
      if (res.matches.length > 1) {
        return {
          kind: 'ambiguous',
          candidates: res.matches.map((m) => m.vendorName),
        } satisfies DriverLookup
      }
      return { kind: 'notFound' } satisfies DriverLookup
    })
    keys.forEach((key, i) => cache.set(key, lookups[i]))

    for (const lookup of lookups) {
      if (lookup.kind === 'failed') meta.errors.push(lookup.message)
    }

    const targetOrderNos = new Set(meta.checkedOrderNos)
    const results = input.results.map((result) => {
      if (!targetOrderNos.has(result.orderNo)) return result
      const driver = input.trackFacts[result.orderNo]!.firstAssignCancelDriver!
      const lookup = cache.get(driver.driverId || driver.driverName)
      if (!lookup) return result

      if (lookup.kind === 'resolved') meta.enrichedOrderNos.push(result.orderNo)
      if (lookup.kind === 'ambiguous') meta.ambiguousOrderNos.push(result.orderNo)

      // 只附加 extraData，判定结论字段原样保留
      return { ...result, extraData: buildExtraData(driver, lookup) }
    })

    return { results, meta }
  } catch (e) {
    // 富化阶段的任何异常都不得影响分析结论
    const message = (e as Error).message || '司机供应商富化失败'
    console.error(`[driver-vendor-enrich] ${message}`)
    return { results: input.results, meta: { ...meta, errors: [...meta.errors, message] } }
  }
}
