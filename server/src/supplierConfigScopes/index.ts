export type { SupplierConfigScopeKey, SupplierConfigScopeStore } from './types'
export {
  getSupplierConfigScopeStore,
  isSupplierConfigScopeKey,
  listSupplierConfigScopeKeys,
} from './registry'

import { listPushableSupplierPushConfigsByIds } from '../supplierPushConfigs'
import { getSupplierConfigScopeStore } from './registry'
import type { SupplierConfigScopeKey } from './types'

/** 定时任务等服务端逻辑：scope 启用列表 ∩ catalog 可推送配置 */
export async function listPushableConfigsForScope(scopeKey: SupplierConfigScopeKey) {
  const store = getSupplierConfigScopeStore(scopeKey)
  const enabledIds = await store.loadEnabledConfigIds()
  return listPushableSupplierPushConfigsByIds(enabledIds)
}
