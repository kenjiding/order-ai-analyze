import type { VendorAnalyzeArtifact } from './vendorAnalysisApi'
import type { FetchedData } from './useVendorAnalysisPage'
import { VENDOR_ANALYSIS_DATA_SOURCES, type VendorAnalysisDataSource } from './metricsRegistry'

/**
 * 每个数据源在 FetchedData / VendorAnalyzeArtifact 中落地的字段。
 * 增量合并（mergeFetchedArtifact）按此表只覆盖本次实际抓取到的数据源对应字段，
 * 新增数据源时需要在此同步登记，否则该数据源的增量结果不会被合并进页面状态。
 */
const DATA_SOURCE_FIELDS: Record<VendorAnalysisDataSource, (keyof FetchedData)[]> = {
  tickets: ['tickets'],
  unprocessed: ['unprocessedTickets'],
  longTail: ['longTailOrders'],
  before11: ['before11ExitRateByVendor', 'driverYesterdayWaybills'],
  waybills: ['waybills'],
  driverWaybills: ['driverDayBeforeWaybills'],
  driverReturn: ['driverReturnRows'],
}

/**
 * 合并一次 analyze 任务的结果到当前页面状态。
 * - 首次拉取（prev 为空）：直接采用完整结果（等价于替换）。
 * - 增量拉取（prev 已有数据）：本次任务可能只抓取了 artifact.dataSources 里的部分数据源，
 *   其余字段仍是 handler 里的默认空值，必须保留 prev 对应字段，否则会被空值覆盖导致数据丢失。
 */
export function mergeFetchedArtifact(prev: FetchedData | null, artifact: VendorAnalyzeArtifact): FetchedData {
  if (!prev) return { ...artifact, fetchedAt: new Date() }

  const fetchedSources = new Set<VendorAnalysisDataSource>(
    (artifact.dataSources as VendorAnalysisDataSource[] | undefined) ?? [...VENDOR_ANALYSIS_DATA_SOURCES],
  )
  const merged: FetchedData = { ...prev, ...artifact, fetchedAt: new Date() }
  for (const source of VENDOR_ANALYSIS_DATA_SOURCES) {
    if (fetchedSources.has(source)) continue
    for (const field of DATA_SOURCE_FIELDS[source]) {
      ;(merged as Record<string, unknown>)[field] = (prev as Record<string, unknown>)[field]
    }
  }
  merged.dataSources = [...new Set([...(prev.dataSources ?? []), ...fetchedSources])].sort()
  return merged
}
