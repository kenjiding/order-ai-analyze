/**
 * 供应商范围归属 —— 「这单属于哪个供应商的统计范围」的唯一权威。
 *
 * 判定链：courierVendorCode 归属 → routeCode 纳入名单收窄 → 路由码白名单剔除。
 * 「供应商数据分析」「11点前出仓告警」「24小时派签告警」共用同一份供应商配置
 * （fleet_supplier_push_configs），也必须共用这里的同一套判定；业务侧不允许重抄
 * 过滤条件，改口径只改这个文件。
 */
import type { FleetSupplierPushConfig } from '../db/schema'
import { parseRouteCodes } from '../supplierPushConfigs'

/** 纳入名单 / 白名单，均按 vendorCode 索引；map 无该供应商 = 不收窄 / 无白名单 */
export type VendorScopeMaps = {
  routeCodesByVendor: Map<string, Set<string>>
  routeCodeWhitelistByVendor: Map<string, Set<string>>
}

export function normCode(code: unknown): string {
  return typeof code === 'string' ? code.trim() : ''
}

/**
 * 路由码纳入名单：供应商配置了 routeCode 时，只保留命中的运单。
 * - map 无该供应商 → 不按路由码收窄（未配置供应商 / 老任务）
 * - map 有该供应商但集合为空 → 无匹配
 */
export function isRouteCodeAllowed(
  vendorCode: string,
  routeCode: string,
  routeCodesByVendor: Map<string, Set<string>>,
): boolean {
  const allowed = routeCodesByVendor.get(vendorCode)
  if (!allowed) return true
  return allowed.has(routeCode.trim())
}

/** 路由码白名单命中：该供应商这条数据要剔除，不参与任何统计 */
export function isWhitelisted(
  vendorCode: string,
  routeCode: string,
  routeCodeWhitelistByVendor: Map<string, Set<string>>,
): boolean {
  return routeCodeWhitelistByVendor.get(vendorCode)?.has(routeCode.trim()) ?? false
}

/** 归属判定唯一入口：routeCode 纳入收窄 + 白名单剔除（vendorCode 归属由调用方按行匹配后传入） */
export function isRowInVendorScope(
  vendorCode: string,
  rowRouteCode: unknown,
  scope: VendorScopeMaps,
): boolean {
  const routeCode = normCode(rowRouteCode)
  return (
    isRouteCodeAllowed(vendorCode, routeCode, scope.routeCodesByVendor) &&
    !isWhitelisted(vendorCode, routeCode, scope.routeCodeWhitelistByVendor)
  )
}

/**
 * routeCode → 配置了该路由码的供应商列表：从 routeCodesByVendor 反转而来，
 * 供 courierVendorCode 为空时（尚未派件，iMile 还没回填承运商）按路由码兜底归属使用。
 * 一个路由码可能同时配置在多个供应商名下（两家供应商共担同一路由，业务上正常）——
 * 每个供应商各自独立按自己配置的路由码匹配、各自统计，不存在"归属唯一"的排他性判断。
 */
export function buildRouteCodeVendorsMap(routeCodesByVendor: Map<string, Set<string>>): Map<string, string[]> {
  const routeToVendors = new Map<string, string[]>()
  for (const [vendorCode, routeCodes] of routeCodesByVendor) {
    for (const routeCode of routeCodes) {
      const list = routeToVendors.get(routeCode)
      if (list) list.push(vendorCode)
      else routeToVendors.set(routeCode, [vendorCode])
    }
  }
  return routeToVendors
}

/** 按 routeCode 查出所有配置了该路由码的供应商（可能为空、一个或多个） */
export function resolveVendorCodesByRouteCode(
  routeCode: unknown,
  routeCodeVendorsMap: Map<string, string[]>,
): string[] {
  const code = normCode(routeCode)
  if (!code) return []
  return routeCodeVendorsMap.get(code) ?? []
}

type ScopeConfigRow = Pick<FleetSupplierPushConfig, 'vendorCode' | 'routeCode' | 'routeCodeWhitelist'>

/**
 * 单条推送配置 → 独立范围。告警逐配置推送；同 vendorCode 不同 routeCode 的多条配置
 * 各自独立统计，互不混算。routeCode 为空时不建纳入条目（= 不收窄），与分析侧合并语义一致。
 */
export function buildScopeMapsFromConfig(config: ScopeConfigRow): VendorScopeMaps {
  const scope: VendorScopeMaps = { routeCodesByVendor: new Map(), routeCodeWhitelistByVendor: new Map() }
  const vendorCode = normCode(config.vendorCode)
  if (!vendorCode) return scope
  const routeCodes = new Set(parseRouteCodes(config.routeCode ?? ''))
  const whitelist = new Set(parseRouteCodes(config.routeCodeWhitelist ?? ''))
  if (routeCodes.size > 0) scope.routeCodesByVendor.set(vendorCode, routeCodes)
  if (whitelist.size > 0) scope.routeCodeWhitelistByVendor.set(vendorCode, whitelist)
  return scope
}

/**
 * 多条配置 → 按 vendorCode 取并集（「供应商数据分析」整体口径）。
 * 返回 JSON 可序列化形式，供任务 payload 冻结；worker 侧再解析回 VendorScopeMaps。
 */
export function buildScopeRecordsFromConfigs(configs: ScopeConfigRow[]): {
  routeCodesByVendor: Record<string, string[]>
  routeCodeWhitelistByVendor: Record<string, string[]>
} {
  const routeCodesByVendor: Record<string, string[]> = {}
  const routeCodeWhitelistByVendor: Record<string, string[]> = {}
  const mergeInto = (target: Record<string, string[]>, vendorCode: string, codes: string[]) => {
    if (codes.length === 0) return
    const merged = new Set(target[vendorCode] ?? [])
    for (const code of codes) merged.add(code)
    target[vendorCode] = [...merged]
  }
  for (const config of configs) {
    const vendorCode = normCode(config.vendorCode)
    if (!vendorCode) continue
    mergeInto(routeCodesByVendor, vendorCode, parseRouteCodes(config.routeCode ?? ''))
    mergeInto(routeCodeWhitelistByVendor, vendorCode, parseRouteCodes(config.routeCodeWhitelist ?? ''))
  }
  return { routeCodesByVendor, routeCodeWhitelistByVendor }
}
