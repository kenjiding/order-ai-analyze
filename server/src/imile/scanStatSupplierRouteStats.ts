/**
 * PDA 扫描统计「发送订单号」：按运单号查到的路由码，匹配当前账号可见的供应商配置，
 * 统计每个供应商下各路由码的件数。
 *
 * 不直接用 buildSupplierUnitIndex：
 * 1. 它要求 vendorCode 非空才建索引单位，纯路由码配置（不选供应商、只填路由码）会被整条跳过——
 *    这里反过来恰好是主要场景（本功能没有承运商编码，只能按路由码识别），必须纳入。
 * 2. resolve() 会按 routeCodeWhitelist 剔除——那是告警类业务的口径（"这条路由不算这家供应商的责任，
 *    不计入告警统计"），本功能只是识别归属，不该套用，否则白名单里的路由码会被判成"未匹配供应商"。
 * 因此改用同一份归属判定的底层入口 isRowInConfigScopeIgnoringWhitelist，自己按展示名归并单位
 * （归并逻辑与 buildSupplierUnitIndex 一致，只是不过滤 vendorCode），语义上对应它的
 * resolveIgnoringWhitelist（该入口本就是给"白名单不参与剔除"的识别类场景用的，见其文档注释）。
 */
import type { FleetSupplierPushConfig } from '../db/schema'
import { isRowInConfigScopeIgnoringWhitelist, normCode } from '../vendorAnalysis/supplierScope'
import { parseRouteCodes, supplierDisplayName } from '../supplierPushConfigs'

type RouteUnit = { supplierKey: string; supplierName: string; vendorCode: string; routeCodes: Set<string> }

function buildRouteUnits(
  configs: Pick<FleetSupplierPushConfig, 'vendorCode' | 'vendorName' | 'supplierNickname' | 'routeCode'>[],
): RouteUnit[] {
  const units = new Map<string, RouteUnit>()
  for (const config of configs) {
    const vendorCode = normCode(config.vendorCode)
    const supplierName = supplierDisplayName(config)
    const supplierKey = `${vendorCode}::${supplierName}`
    const unit = units.get(supplierKey) ?? { supplierKey, supplierName, vendorCode, routeCodes: new Set<string>() }
    for (const code of parseRouteCodes(config.routeCode ?? '')) unit.routeCodes.add(code)
    units.set(supplierKey, unit)
  }
  return [...units.values()]
}

export type ScanStatRouteCount = { routeCode: string; count: number }

export type ScanStatSupplierRouteGroup = {
  supplierKey: string
  supplierName: string
  total: number
  routes: ScanStatRouteCount[]
}

export type ScanStatRouteStats = {
  /** 按件数降序 */
  suppliers: ScanStatSupplierRouteGroup[]
  /** 查到路由码但未匹配任何供应商配置 */
  unmatchedRoutes: ScanStatRouteCount[]
  /** 没查到路由码的单号数 */
  noRouteCodeCount: number
}

export function buildScanStatSupplierRouteStats(
  waybillNos: string[],
  routeCodeByWaybill: Map<string, string>,
  configs: Pick<FleetSupplierPushConfig, 'vendorCode' | 'vendorName' | 'supplierNickname' | 'routeCode'>[],
): ScanStatRouteStats {
  const units = buildRouteUnits(configs)
  const bySupplier = new Map<string, { supplierName: string; routes: Map<string, number> }>()
  const unmatched = new Map<string, number>()
  let noRouteCodeCount = 0

  for (const waybillNo of waybillNos) {
    const routeCode = routeCodeByWaybill.get(waybillNo) ?? ''
    if (!routeCode) {
      noRouteCodeCount++
      continue
    }
    const matchedUnits = units.filter((unit) =>
      isRowInConfigScopeIgnoringWhitelist(
        { vendorCode: unit.vendorCode, routeCodes: unit.routeCodes.size > 0 ? unit.routeCodes : undefined },
        '',
        routeCode,
      ),
    )
    if (matchedUnits.length === 0) {
      unmatched.set(routeCode, (unmatched.get(routeCode) ?? 0) + 1)
      continue
    }
    for (const unit of matchedUnits) {
      const group = bySupplier.get(unit.supplierKey) ?? { supplierName: unit.supplierName, routes: new Map() }
      group.routes.set(routeCode, (group.routes.get(routeCode) ?? 0) + 1)
      bySupplier.set(unit.supplierKey, group)
    }
  }

  const sortRoutes = (routes: Map<string, number>): ScanStatRouteCount[] =>
    Array.from(routes.entries())
      .map(([routeCode, count]) => ({ routeCode, count }))
      .sort((a, b) => b.count - a.count || a.routeCode.localeCompare(b.routeCode))

  const suppliers: ScanStatSupplierRouteGroup[] = Array.from(bySupplier.entries())
    .map(([supplierKey, group]) => {
      const routes = sortRoutes(group.routes)
      return { supplierKey, supplierName: group.supplierName, total: routes.reduce((sum, r) => sum + r.count, 0), routes }
    })
    .sort((a, b) => b.total - a.total || a.supplierName.localeCompare(b.supplierName))

  return { suppliers, unmatchedRoutes: sortRoutes(unmatched), noRouteCodeCount }
}

/** 发飞书私聊的路由码统计文本：供应商按件数降序，组内路由码也按件数降序，一个空行隔开各供应商。 */
export function buildScanStatRouteText(stationName: string, total: number, stats: ScanStatRouteStats): string {
  const lines = [
    `${stationName ? `${stationName} ` : ''}订单号（${total}），共 ${stats.suppliers.length} 个供应商：`,
    '',
  ]
  if (stats.suppliers.length === 0) {
    lines.push('未匹配到任何供应商配置的路由码')
  }
  for (const supplier of stats.suppliers) {
    lines.push(`${supplier.supplierName}`)
    for (const r of supplier.routes) lines.push(`${r.routeCode}: ${r.count}`)
    lines.push('')
  }
  if (stats.unmatchedRoutes.length > 0) {
    lines.push('未匹配供应商的路由码')
    for (const r of stats.unmatchedRoutes) lines.push(`${r.routeCode}: ${r.count}`)
    lines.push('')
  }
  if (stats.noRouteCodeCount > 0) {
    lines.push(`未查到路由码：${stats.noRouteCodeCount} 单`)
  }
  while (lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}
