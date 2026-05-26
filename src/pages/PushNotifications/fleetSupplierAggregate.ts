import { normFleetRouteCodeForMatch, parseFleetRouteCodes } from './fleetRouteCodeParse'
import type { FleetRouteBucket, FleetScanRow } from './fleetSupplierPushTypes'

/**
 * 先按路由编码（应匹配供应商配置；支持多个编码，以空格/逗号分隔），再按收件人邮编、收件人城市聚合；
 * 单量：同一城市下按 orderKey 去重计数。
 */
export function aggregateFleetRowsForRoute(rows: FleetScanRow[], routeFilterRaw: string): FleetRouteBucket[] {
  const targets = parseFleetRouteCodes(routeFilterRaw)
  if (!targets.length) return []

  const targetSet = new Set(targets.map((c) => normFleetRouteCodeForMatch(c)))

  type CityAcc = Map<string, Set<string>>
  type PostAcc = Map<string, CityAcc>
  type RouteAcc = Map<string, PostAcc>

  const acc: RouteAcc = new Map()

  for (const row of rows) {
    if (!targetSet.has(normFleetRouteCodeForMatch(row.routeCode))) continue

    const rc = row.routeCode.trim()
    const pc = row.postcode.trim() || '—'
    const ct = row.city.trim() || '—'

    if (!acc.has(rc)) acc.set(rc, new Map())
    const byPost = acc.get(rc)!
    if (!byPost.has(pc)) byPost.set(pc, new Map())
    const byCity = byPost.get(pc)!
    if (!byCity.has(ct)) byCity.set(ct, new Set())
    byCity.get(ct)!.add(row.orderKey)
  }

  const routeBuckets: FleetRouteBucket[] = []

  for (const [routeCode, byPost] of acc) {
    const postcodes: FleetRouteBucket['postcodes'] = []
    let routeTotal = 0

    const sortedPosts = [...byPost.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))

    for (const [postcode, byCity] of sortedPosts) {
      const cities: { city: string; count: number }[] = []
      let postTotal = 0

      const sortedCities = [...byCity.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
      for (const [city, set] of sortedCities) {
        const count = set.size
        postTotal += count
        cities.push({ city, count })
      }

      routeTotal += postTotal
      postcodes.push({ postcode, cities, total: postTotal })
    }

    routeBuckets.push({ routeCode, postcodes, total: routeTotal })
  }

  routeBuckets.sort((a, b) => a.routeCode.localeCompare(b.routeCode, 'zh-CN'))
  return routeBuckets
}
