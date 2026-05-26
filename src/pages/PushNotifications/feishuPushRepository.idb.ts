import type { DBSchema } from 'idb'
import { createSingletonIdb } from '../../storage/createSingletonIdb'
import type { FeishuPushStoredShapeV1, FeishuPushStore } from './feishuPushStorage'
import {
  emptyFeishuPushStore,
  FEISHU_PUSH_STORAGE_KEY,
  normalizeFeishuPushFromParsed,
  toFeishuPushStoredPayload,
} from './feishuPushStorage'

const DB_NAME = 'warehouse-feishu-push-config'
const DB_VERSION = 1
const DOC_STORE = 'feishuPushDocs'
const DOC_KEY = 'configs.v1'

type FeishuPushConfigDb = DBSchema & {
  [DOC_STORE]: {
    key: string
    value: FeishuPushStoredShapeV1
  }
}

const openDb = createSingletonIdb<FeishuPushConfigDb>({
  name: DB_NAME,
  version: DB_VERSION,
  upgrade(db) {
    if (!db.objectStoreNames.contains(DOC_STORE)) {
      db.createObjectStore(DOC_STORE)
    }
  },
})

function consumeLegacyLocalStorageJson(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(FEISHU_PUSH_STORAGE_KEY)
    if (raw === null) return null
    localStorage.removeItem(FEISHU_PUSH_STORAGE_KEY)
    return raw
  } catch {
    try {
      localStorage.removeItem(FEISHU_PUSH_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    return null
  }
}

export async function loadFeishuPushStore(): Promise<FeishuPushStore> {
  if (typeof indexedDB === 'undefined') return emptyFeishuPushStore()

  try {
    const db = await openDb()
    const row = await db.get(DOC_STORE, DOC_KEY)
    if (row !== undefined) {
      const { store, needsCanonicalResave } = normalizeFeishuPushFromParsed(row)
      if (needsCanonicalResave) {
        await db.put(DOC_STORE, toFeishuPushStoredPayload(store), DOC_KEY)
      }
      return store
    }

    const legacyRaw = consumeLegacyLocalStorageJson()
    if (legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw) as unknown
        const { store } = normalizeFeishuPushFromParsed(parsed)
        const payload = toFeishuPushStoredPayload(store)
        await db.put(DOC_STORE, payload, DOC_KEY)
        return store
      } catch {
        return emptyFeishuPushStore()
      }
    }

    return emptyFeishuPushStore()
  } catch {
    return emptyFeishuPushStore()
  }
}

export async function persistFeishuPushStore(store: FeishuPushStore): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await db.put(DOC_STORE, toFeishuPushStoredPayload(store), DOC_KEY)
}
