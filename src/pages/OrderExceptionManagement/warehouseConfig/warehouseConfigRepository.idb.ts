import type { DBSchema } from 'idb'
import { createSingletonIdb } from '../../../storage/createSingletonIdb'
import { cloneDefaultWarehouseConfig, DEFAULT_WAREHOUSE_CONFIG } from './defaults'
import type { WarehouseConfigDto } from './types'

const DB_NAME = 'order-exception-warehouse-config'
const DB_VERSION = 1
const DOC_STORE = 'warehouseConfigDocs'
const DOC_KEY = 'warehouseConfig'

type WarehouseConfigDb = DBSchema & {
  [DOC_STORE]: {
    key: string
    value: WarehouseConfigDto
  }
}

const openDb = createSingletonIdb<WarehouseConfigDb>({
  name: DB_NAME,
  version: DB_VERSION,
  upgrade(db) {
    if (!db.objectStoreNames.contains(DOC_STORE)) {
      db.createObjectStore(DOC_STORE)
    }
  },
})

function isWarehouseConfigDto(raw: unknown): raw is WarehouseConfigDto {
  if (!raw || typeof raw !== 'object') return false
  const config = raw as WarehouseConfigDto
  if (!config.global || !Array.isArray(config.profiles)) return false
  return config.profiles.every((profile) => typeof profile.name === 'string' && profile.name.trim())
}

export async function loadWarehouseConfigFromIdb(): Promise<WarehouseConfigDto> {
  if (typeof indexedDB === 'undefined') return cloneDefaultWarehouseConfig()
  try {
    const db = await openDb()
    const stored = await db.get(DOC_STORE, DOC_KEY)
    if (stored && isWarehouseConfigDto(stored)) return stored
    return cloneDefaultWarehouseConfig()
  } catch {
    return cloneDefaultWarehouseConfig()
  }
}

export async function saveWarehouseConfigToIdb(config: WarehouseConfigDto): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await db.put(DOC_STORE, config, DOC_KEY)
}

export { DEFAULT_WAREHOUSE_CONFIG }
