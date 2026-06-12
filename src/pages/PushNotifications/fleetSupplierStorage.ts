import { generateId } from '../../utils/generateId'
import type { FleetSupplierConfig } from './fleetSupplierPushTypes'

/**
 * 历史 localStorage 键：首次打开页面时由 `fleetSupplierRepository.idb` 读入 IndexedDB 后删除。
 * 新数据仅写入 IndexedDB（`warehouse-fleet-supplier-push` · `fleetSupplierDocs` · `suppliers.v1`）。
 */
export const FLEET_SUPPLIER_STORAGE_KEY = 'warehouse.fleetSupplierPush.suppliers.v1'

export function sanitizeFleetSupplier(
  raw: unknown,
  options?: { generateId?: () => string },
): FleetSupplierConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  let id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : ''
  if (!id && options?.generateId) id = options.generateId()
  if (!id) return null
  const supplierName = typeof o.supplierName === 'string' ? o.supplierName.trim() : ''
  const routeCode = typeof o.routeCode === 'string' ? o.routeCode.trim() : ''
  const webhookUrl = typeof o.webhookUrl === 'string' ? o.webhookUrl.trim() : ''
  const signingSecret =
    typeof o.signingSecret === 'string' && o.signingSecret.trim() !== '' ? o.signingSecret.trim() : undefined
  const pushContent = typeof o.pushContent === 'string' ? o.pushContent : ''
  return { id, supplierName, routeCode, webhookUrl, signingSecret, pushContent }
}

export function createFleetSupplierId(): string {
  return generateId()
}
