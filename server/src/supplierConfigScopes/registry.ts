import { exitAlarmScheduledScope } from './exitAlarmScheduled'
import { vendorAnalysisPushScope } from './vendorAnalysisPush'
import { chaseDispatchScheduledScope } from './chaseDispatchScheduled'
import type { SupplierConfigScopeKey, SupplierConfigScopeStore } from './types'

const STORES: Record<SupplierConfigScopeKey, SupplierConfigScopeStore> = {
  'exit-alarm.scheduled': exitAlarmScheduledScope,
  'vendor-analysis.push': vendorAnalysisPushScope,
  'chase-dispatch.scheduled': chaseDispatchScheduledScope,
}

export function isSupplierConfigScopeKey(raw: string): raw is SupplierConfigScopeKey {
  return Object.prototype.hasOwnProperty.call(STORES, raw)
}

export function getSupplierConfigScopeStore(scopeKey: SupplierConfigScopeKey): SupplierConfigScopeStore {
  return STORES[scopeKey]
}

export function listSupplierConfigScopeKeys(): SupplierConfigScopeKey[] {
  return Object.keys(STORES) as SupplierConfigScopeKey[]
}
