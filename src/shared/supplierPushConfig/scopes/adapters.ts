import { loadScopeEnabledIds, saveScopeEnabledIds } from '../scopeApi'
import type { SupplierConfigScopeAdapter, SupplierConfigScopeKey } from '../types'

function createScopeAdapter(scopeKey: SupplierConfigScopeKey): SupplierConfigScopeAdapter {
  return {
    scopeKey,
    async loadEnabledIds() {
      const res = await loadScopeEnabledIds(scopeKey)
      if (!res.ok) return res
      return { ok: true, enabledIds: res.data.enabledIds }
    },
    async saveEnabledIds(enabledIds) {
      const res = await saveScopeEnabledIds(scopeKey, enabledIds)
      if (!res.ok) return res
      return { ok: true, enabledIds: res.data.enabledIds }
    },
  }
}

/** 注册新业务 scope：在此追加 adapter，并实现 server/supplierConfigScopes 对应 store */
export const SUPPLIER_CONFIG_SCOPE_ADAPTERS: Record<
  SupplierConfigScopeKey,
  SupplierConfigScopeAdapter
> = {
  'vendor-analysis.push': createScopeAdapter('vendor-analysis.push'),
  'work-order-push.scheduled': createScopeAdapter('work-order-push.scheduled'),
}

export function getSupplierConfigScopeAdapter(
  scopeKey: SupplierConfigScopeKey,
): SupplierConfigScopeAdapter {
  return SUPPLIER_CONFIG_SCOPE_ADAPTERS[scopeKey]
}
