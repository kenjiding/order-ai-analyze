import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/**
 * 单例打开 IndexedDB，避免页面/仓库多处重复 `openDB` 与版本升级脚本。
 */
export function createSingletonIdb<T extends DBSchema>(opts: {
  name: string
  version: number
  upgrade: (db: IDBPDatabase<T>, oldVersion: number, newVersion: number | null) => void
}): () => Promise<IDBPDatabase<T>> {
  let promise: Promise<IDBPDatabase<T>> | null = null
  return () => {
    if (!promise) {
      promise = openDB<T>(opts.name, opts.version, {
        upgrade(db, oldVersion, newVersion) {
          opts.upgrade(db, oldVersion, newVersion)
        },
      })
    }
    return promise
  }
}
