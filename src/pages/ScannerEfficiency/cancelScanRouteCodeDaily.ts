import type { RouteCodeDistributionItem } from './scannerEfficiencyApi'
import type { DailyRouteCodeCount } from './cancelScanAnalysisTypes'

/** 逐日过滤后保留的 scanDate × 路由码 明细 */
export function filterDailyRouteCodeCounts(
  dailyItems: DailyRouteCodeCount[],
  maxCount: number | null,
): DailyRouteCodeCount[] {
  if (maxCount == null || !Number.isFinite(maxCount) || maxCount < 0) return dailyItems
  const threshold = Math.floor(maxCount)
  return dailyItems.filter((item) => item.count <= threshold)
}

/** 按 cancelScan.scanDate 分组后，逐日过滤（去掉当日 count > maxCount 的路由码）再跨日汇总 */
export function aggregateRouteCodeDistribution(
  dailyItems: DailyRouteCodeCount[],
  maxCount: number | null,
): RouteCodeDistributionItem[] {
  const filtered = filterDailyRouteCodeCounts(dailyItems, maxCount)
  const aggregated = new Map<string, number>()

  for (const item of filtered) {
    aggregated.set(item.routeCode, (aggregated.get(item.routeCode) ?? 0) + item.count)
  }

  return Array.from(aggregated.entries())
    .map(([routeCode, count]) => ({ routeCode, count }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.routeCode.localeCompare(b.routeCode))
}

/** 被按日过滤掉的「日期 × 路由码」条目数 */
export function countDailyFilteredRouteCodeEntries(
  dailyItems: DailyRouteCodeCount[],
  maxCount: number | null,
): number {
  if (maxCount == null || !Number.isFinite(maxCount) || maxCount < 0) return 0
  const threshold = Math.floor(maxCount)
  return dailyItems.filter((item) => item.count > threshold).length
}

/** 无按日明细时回退：对汇总结果直接过滤 */
export function filterAggregatedRouteCodeDistribution(
  distribution: RouteCodeDistributionItem[],
  maxCount: number | null,
): RouteCodeDistributionItem[] {
  if (maxCount == null || !Number.isFinite(maxCount) || maxCount < 0) return distribution
  const threshold = Math.floor(maxCount)
  return distribution.filter((item) => item.count <= threshold)
}

export function resolveFilteredRouteCodeDistribution(input: {
  dailyRouteCodeCounts?: DailyRouteCodeCount[]
  routeCodeDistribution: RouteCodeDistributionItem[]
  maxCount: number | null
}): RouteCodeDistributionItem[] {
  if (input.dailyRouteCodeCounts?.length) {
    return aggregateRouteCodeDistribution(input.dailyRouteCodeCounts, input.maxCount)
  }
  return filterAggregatedRouteCodeDistribution(input.routeCodeDistribution, input.maxCount)
}

export function countHiddenRouteCodeFilterEntries(input: {
  dailyRouteCodeCounts?: DailyRouteCodeCount[]
  routeCodeDistribution: RouteCodeDistributionItem[]
  maxCount: number | null
}): number {
  if (input.dailyRouteCodeCounts?.length) {
    return countDailyFilteredRouteCodeEntries(input.dailyRouteCodeCounts, input.maxCount)
  }
  if (input.maxCount == null || !Number.isFinite(input.maxCount) || input.maxCount < 0) return 0
  const threshold = Math.floor(input.maxCount)
  return input.routeCodeDistribution.filter((item) => item.count > threshold).length
}
