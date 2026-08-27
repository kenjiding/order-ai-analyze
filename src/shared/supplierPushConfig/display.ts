import type { SupplierPushConfig } from './types'

export function supplierDisplayName(
  config: Pick<SupplierPushConfig, 'supplierNickname' | 'vendorName'>,
): string {
  const nick = config.supplierNickname?.trim()
  if (nick) return nick
  return config.vendorName?.trim() || '未知供应商'
}

/**
 * 供应商单位键：与后端 server/src/vendorAnalysis/supplierScope.ts 的 buildSupplierUnitKey 必须一致，
 * 前端才能把供应商配置 join 上后端按单位聚合的汇总。
 * 同一 vendorCode 下按展示名区分（ADL-City / ADL-Lu 共用编码，业务上是两家）。
 */
export function buildSupplierUnitKey(
  config: Pick<SupplierPushConfig, 'vendorCode' | 'supplierNickname' | 'vendorName'>,
): string {
  return `${config.vendorCode.trim()}::${supplierDisplayName(config)}`
}

export function truncateSupplierFieldMid(value: string, max: number): string {
  if (value.length <= max) return value
  const edge = Math.max(4, Math.floor((max - 1) / 2))
  return `${value.slice(0, edge)}…${value.slice(value.length - edge)}`
}
