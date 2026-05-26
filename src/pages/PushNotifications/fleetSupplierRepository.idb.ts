import type { DBSchema } from 'idb'
import { createSingletonIdb } from '../../storage/createSingletonIdb'
import type { FleetSupplierConfig } from './fleetSupplierPushTypes'
import { FLEET_SUPPLIER_STORAGE_KEY, sanitizeFleetSupplier } from './fleetSupplierStorage'

const DB_NAME = 'warehouse-fleet-supplier-push'
const DB_VERSION = 1
const DOC_STORE = 'fleetSupplierDocs'
const DOC_KEY = 'suppliers.v1'

type FleetSupplierPushDb = DBSchema & {
  [DOC_STORE]: {
    key: string
    value: FleetSupplierConfig[]
  }
}

const openDb = createSingletonIdb<FleetSupplierPushDb>({
  name: DB_NAME,
  version: DB_VERSION,
  upgrade(db) {
    if (!db.objectStoreNames.contains(DOC_STORE)) {
      db.createObjectStore(DOC_STORE)
    }
  },
})

function sanitizeList(raw: unknown): FleetSupplierConfig[] {
  if (!Array.isArray(raw)) return []
  const out: FleetSupplierConfig[] = []
  for (const item of raw) {
    const s = sanitizeFleetSupplier(item)
    if (s) out.push(s)
  }
  return out
}

/** 若存在旧版 localStorage 备份则读出并清除该项，避免重复迁移 */
function consumeLegacyLocalStorage(): FleetSupplierConfig[] | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(FLEET_SUPPLIER_STORAGE_KEY)
    if (raw === null) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      localStorage.removeItem(FLEET_SUPPLIER_STORAGE_KEY)
      return []
    }
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(FLEET_SUPPLIER_STORAGE_KEY)
      return []
    }
    const list = sanitizeList(parsed)
    localStorage.removeItem(FLEET_SUPPLIER_STORAGE_KEY)
    return list
  } catch {
    try {
      localStorage.removeItem(FLEET_SUPPLIER_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    return []
  }
}

export async function loadFleetSuppliers(): Promise<FleetSupplierConfig[]> {
  if (typeof indexedDB === 'undefined') return []

  try {
    const db = await openDb()
    const existing = await db.get(DOC_STORE, DOC_KEY)
    if (existing !== undefined) {
      return sanitizeList(existing)
    }

    const legacy = consumeLegacyLocalStorage()
    if (legacy !== null) {
      await db.put(DOC_STORE, legacy, DOC_KEY)
      return legacy
    }

    return []
  } catch {
    return []
  }
}

export async function persistFleetSuppliers(list: FleetSupplierConfig[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await db.put(DOC_STORE, list, DOC_KEY)
}
