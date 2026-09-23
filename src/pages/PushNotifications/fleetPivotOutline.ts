import type { FleetRouteBucket } from './fleetSupplierPushTypes'

export type FleetPivotOutlineRowKind = 'route' | 'post' | 'detail' | 'detailAlt'

export type FleetPivotOutlineRow = {
  key: string
  kind: FleetPivotOutlineRowKind
  c0: string
  c1: string
  c2: string
  c3: string
  /** 仅 'route' 行有值：该路由命中「优先客户配置」的单量 */
  priorityTotal?: number
}

/**
 * 与飞书截图 / FleetPivotReportView 一致的透视大纲行（路由合计 → 邮编小计 → 城市明细）。
 */
export function buildFleetPivotOutlineModel(buckets: FleetRouteBucket[]): {
  bodyRows: FleetPivotOutlineRow[]
  grandTotal: number
  grandPriorityTotal: number
} {
  const bodyRows: FleetPivotOutlineRow[] = []
  let grandTotal = 0
  let grandPriorityTotal = 0
  let n = 0

  for (const route of buckets) {
    grandTotal += route.total
    grandPriorityTotal += route.priorityTotal
    n += 1
    bodyRows.push({
      key: `r-${route.routeCode}-${n}`,
      kind: 'route',
      c0: route.routeCode,
      c1: '',
      c2: '',
      c3: String(route.total),
      priorityTotal: route.priorityTotal,
    })
    for (const pc of route.postcodes) {
      n += 1
      bodyRows.push({
        key: `p-${route.routeCode}-${pc.postcode}-${n}`,
        kind: 'post',
        c0: '',
        c1: pc.postcode,
        c2: '',
        c3: String(pc.total),
      })
      let detailAlt = false
      for (const city of pc.cities) {
        n += 1
        bodyRows.push({
          key: `d-${n}-${city.city}`,
          kind: detailAlt ? 'detailAlt' : 'detail',
          c0: '',
          c1: '',
          c2: city.city,
          c3: String(city.count),
        })
        detailAlt = !detailAlt
      }
    }
  }

  return { bodyRows, grandTotal, grandPriorityTotal }
}
