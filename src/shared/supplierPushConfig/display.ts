import type { SupplierPushConfig } from './types'

export function supplierDisplayName(
  config: Pick<SupplierPushConfig, 'supplierNickname' | 'vendorName'>,
): string {
  const nick = config.supplierNickname?.trim()
  if (nick) return nick
  return config.vendorName?.trim() || '未知供应商'
}

export function truncateSupplierFieldMid(value: string, max: number): string {
  if (value.length <= max) return value
  const edge = Math.max(4, Math.floor((max - 1) / 2))
  return `${value.slice(0, edge)}…${value.slice(value.length - edge)}`
}
