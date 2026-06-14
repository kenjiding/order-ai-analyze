import type { RouteCodeDistributionItem } from './scannerEfficiencyApi'
import type { DailyRouteCodeCount } from './cancelScanAnalysisTypes'
import { filterDailyRouteCodeCounts } from './cancelScanRouteCodeDaily'

export type RouteCodeDailyCount = {
  date: string
  count: number
}

export type RouteZoneRouteItem = {
  routeCode: string
  count: number
  zoneShare: number
  totalShare: number
  /** 按 scanDate 拆分的每日票数（过滤后） */
  dailyCounts?: RouteCodeDailyCount[]
}

export type RouteZoneGroup = {
  zone: string
  zoneTotal: number
  totalShare: number
  routeCodes: RouteZoneRouteItem[]
}

/** 从路由码提取区号：FF001 → F区，BB003 → B区 */
export function extractRouteZone(routeCode: string): string {
  const code = String(routeCode ?? '').trim()
  if (!code || code === '(空)') return '未知区'
  const match = code.match(/[A-Za-z]/)
  if (!match) return '其他区'
  return `${match[0].toUpperCase()}区`
}

function zoneSortKey(zone: string): string {
  if (zone === '未知区') return 'zzzz'
  if (zone === '其他区') return 'zzzy'
  return zone
}

export function buildRouteZoneGroups(distribution: RouteCodeDistributionItem[]): RouteZoneGroup[] {
  return buildRouteZoneGroupsInternal(distribution, null)
}

/** 基于 scanDate 按日明细构建大区（保留每个路由码的逐日 breakdown） */
export function buildRouteZoneGroupsFromDaily(
  dailyItems: DailyRouteCodeCount[],
  maxCount: number | null,
): RouteZoneGroup[] {
  const filtered = filterDailyRouteCodeCounts(dailyItems, maxCount)
  const dailyByRoute = new Map<string, RouteCodeDailyCount[]>()

  for (const item of filtered) {
    const list = dailyByRoute.get(item.routeCode) ?? []
    list.push({ date: item.date, count: item.count })
    dailyByRoute.set(item.routeCode, list)
  }

  const distribution: RouteCodeDistributionItem[] = []
  for (const [routeCode, days] of dailyByRoute) {
    const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date))
    dailyByRoute.set(routeCode, sortedDays)
    const total = sortedDays.reduce((sum, day) => sum + day.count, 0)
    if (total > 0) distribution.push({ routeCode, count: total })
  }

  distribution.sort((a, b) => b.count - a.count || a.routeCode.localeCompare(b.routeCode))
  return buildRouteZoneGroupsInternal(distribution, dailyByRoute)
}

function buildRouteZoneGroupsInternal(
  distribution: RouteCodeDistributionItem[],
  dailyByRoute: Map<string, RouteCodeDailyCount[]> | null,
): RouteZoneGroup[] {
  if (!distribution.length) return []

  const grandTotal = distribution.reduce((sum, item) => sum + item.count, 0)
  const byZone = new Map<string, RouteCodeDistributionItem[]>()

  for (const item of distribution) {
    const zone = extractRouteZone(item.routeCode)
    const list = byZone.get(zone) ?? []
    list.push(item)
    byZone.set(zone, list)
  }

  const sortedZones = [...byZone.keys()].sort((a, b) => zoneSortKey(a).localeCompare(zoneSortKey(b)))

  return sortedZones.map((zone) => {
    const items = [...(byZone.get(zone) ?? [])].sort(
      (a, b) => b.count - a.count || a.routeCode.localeCompare(b.routeCode),
    )
    const zoneTotal = items.reduce((sum, item) => sum + item.count, 0)

    return {
      zone,
      zoneTotal,
      totalShare: grandTotal > 0 ? zoneTotal / grandTotal : 0,
      routeCodes: items.map((item) => ({
        routeCode: item.routeCode,
        count: item.count,
        zoneShare: zoneTotal > 0 ? item.count / zoneTotal : 0,
        totalShare: grandTotal > 0 ? item.count / grandTotal : 0,
        ...(dailyByRoute?.has(item.routeCode)
          ? { dailyCounts: dailyByRoute.get(item.routeCode) }
          : {}),
      })),
    }
  })
}

export function countRouteZones(distribution: RouteCodeDistributionItem[]): number {
  const zones = new Set(distribution.map((item) => extractRouteZone(item.routeCode)))
  return zones.size
}
