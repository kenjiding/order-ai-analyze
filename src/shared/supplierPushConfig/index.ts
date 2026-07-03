export type {
  SupplierPushConfig,
  SupplierPushConfigDraft,
  SupplierConfigScopeKey,
  SupplierConfigScopeBinding,
  SupplierConfigScopeAdapter,
  FleetSupplierConfig,
  FleetSupplierConfigDraft,
} from './types'

export { LEGACY_GLOBAL_SUPPLIER_REGION_CODE } from './types'

export {
  SUPPLIER_PUSH_CONFIG_MAINTAIN_PATH,
  SUPPLIER_CONFIG_SCOPE_LABELS,
} from './constants'

export { supplierDisplayName, truncateSupplierFieldMid } from './display'

export {
  isSupplierPushEligible,
  pruneSelectedConfigIds,
  selectedPushableConfigs,
  effectiveSelectedKeys,
  toggleScopeEnabledId,
} from './selection'

export {
  loadSupplierPushCatalog,
  createSupplierPushConfig,
  updateSupplierPushConfig,
  deleteSupplierPushConfig,
  importSupplierPushCatalog,
} from './catalogApi'

export { loadScopeEnabledIds, saveScopeEnabledIds } from './scopeApi'

export {
  SUPPLIER_CONFIG_SCOPE_ADAPTERS,
  getSupplierConfigScopeAdapter,
} from './scopes/adapters'

export { useSupplierPushCatalog } from './hooks/useSupplierPushCatalog'
export { useSupplierConfigScopeBinding } from './hooks/useSupplierConfigScopeBinding'

export {
  buildScopeActionsColumn,
  buildScopeStatusColumn,
  buildScopeStatusAndActionsColumns,
  renderScopeEnableAction,
  renderScopeStatus,
  type ScopeEnableColumnBinding,
} from './components/scopeEnableColumn'
export { buildSupplierPushCatalogColumns } from './components/supplierPushTableColumns'
export {
  SupplierPushConfigPanel,
  type SupplierPushConfigPanelScopeBinding,
  type SupplierPushConfigPanelSelection,
} from './components/SupplierPushConfigPanel'

/**
 * 扩展新业务 scope  checklist:
 * 1. server/supplierConfigScopes/types.ts 增加 scope key
 * 2. server/supplierConfigScopes/<feature>.ts 实现 SupplierConfigScopeStore
 * 3. server/supplierConfigScopes/registry.ts 注册 store
 * 4. src/shared/supplierPushConfig/types.ts 同步 scope key
 * 5. src/shared/supplierPushConfig/constants.ts 增加列标题
 * 6. 页面: useSupplierPushCatalog + useSupplierConfigScopeBinding + SupplierPushConfigPanel
 */
