import type { SupplierPushConfig } from '../../shared/supplierPushConfig/types'

/**
 * 站点配置里选中的 pushConfigIds 是全局 catalog 的子集；同一 vendorCode 可能命中多条
 * （多个群各自要收到通知），全部推送，口径与出仓/派签告警等定时推送一致（一个 config 一次发送）。
 */
export function matchSupplierPushTargets(
  vendorCode: string,
  pushConfigIds: string[],
  catalog: SupplierPushConfig[],
): SupplierPushConfig[] {
  return catalog.filter((c) => pushConfigIds.includes(c.id) && c.vendorCode === vendorCode)
}
