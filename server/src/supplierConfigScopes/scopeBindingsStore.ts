import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { parsePushConfigIds } from '../supplierPushConfigs'
import type { SupplierConfigScopeKey, SupplierConfigScopeStore } from './types'

export function createScopeBindingsStore(scopeKey: SupplierConfigScopeKey): SupplierConfigScopeStore {
  return {
    key: scopeKey,

    async loadEnabledConfigIds() {
      const db = getDb()
      const rows = await db
        .select()
        .from(schema.supplierConfigScopeBindings)
        .where(eq(schema.supplierConfigScopeBindings.scopeKey, scopeKey))
        .limit(1)
      return parsePushConfigIds(rows[0]?.enabledConfigIds)
    },

    async saveEnabledConfigIds(configIds) {
      const normalized = parsePushConfigIds(configIds)
      const db = getDb()
      const existing = await db
        .select()
        .from(schema.supplierConfigScopeBindings)
        .where(eq(schema.supplierConfigScopeBindings.scopeKey, scopeKey))
        .limit(1)
      if (existing.length > 0) {
        const [updated] = await db
          .update(schema.supplierConfigScopeBindings)
          .set({ enabledConfigIds: normalized, updatedAt: new Date() })
          .where(eq(schema.supplierConfigScopeBindings.scopeKey, scopeKey))
          .returning()
        return parsePushConfigIds(updated.enabledConfigIds)
      }
      const [created] = await db
        .insert(schema.supplierConfigScopeBindings)
        .values({ scopeKey, enabledConfigIds: normalized })
        .returning()
      return parsePushConfigIds(created.enabledConfigIds)
    },
  }
}
