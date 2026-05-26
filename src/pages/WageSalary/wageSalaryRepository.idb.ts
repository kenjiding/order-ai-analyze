import type { DBSchema } from 'idb'
import type { RateSettings } from '../../payroll/wageRateCalculation'
import { createSingletonIdb } from '../../storage/createSingletonIdb'
import { mergeRateSettings, type StoredEmployee } from './storage'

const DB_NAME = 'warehouse-wage-salary'
const DB_VERSION = 1
const DOC_STORE = 'wageSalaryDocs'

/** 与历史 localStorage 键一致，便于迁移 */
const DOC_KEYS = {
  rate: 'wageRateSettings',
  actualWorker: 'wageActualWorkerRateSettings',
  employees: 'wageSalaryEmployees',
} as const

type WageSalaryDb = DBSchema & {
  [DOC_STORE]: {
    key: string
    value: unknown
  }
}

const openDb = createSingletonIdb<WageSalaryDb>({
  name: DB_NAME,
  version: DB_VERSION,
  upgrade(db) {
    if (!db.objectStoreNames.contains(DOC_STORE)) {
      db.createObjectStore(DOC_STORE)
    }
  },
})

function consumeLegacyLocalStorageRaw(key: string): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    localStorage.removeItem(key)
    return raw
  } catch {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
    return null
  }
}

function sanitizeEmployees(raw: unknown): StoredEmployee[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (x) => x && typeof x === 'object' && typeof (x as StoredEmployee).employeeId === 'string',
  ) as StoredEmployee[]
}

export async function loadRateSettingsFromIdb(defaults: RateSettings): Promise<RateSettings> {
  if (typeof indexedDB === 'undefined') return defaults
  try {
    const db = await openDb()
    const docKey = DOC_KEYS.rate
    const v = await db.get(DOC_STORE, docKey)
    if (v !== undefined) {
      return mergeRateSettings(v as Partial<RateSettings>, defaults)
    }
    const raw = consumeLegacyLocalStorageRaw(DOC_KEYS.rate)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<RateSettings>
        const merged = mergeRateSettings(parsed, defaults)
        await db.put(DOC_STORE, merged, docKey)
        return merged
      } catch {
        return defaults
      }
    }
    return defaults
  } catch {
    return defaults
  }
}

export async function saveRateSettingsToIdb(settings: RateSettings): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await db.put(DOC_STORE, settings, DOC_KEYS.rate)
}

export async function clearRateSettingsIdb(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await db.delete(DOC_STORE, DOC_KEYS.rate)
}

export async function loadActualWorkerRateSettingsFromIdb(defaults: RateSettings): Promise<RateSettings> {
  if (typeof indexedDB === 'undefined') return defaults
  try {
    const db = await openDb()
    const docKey = DOC_KEYS.actualWorker
    const v = await db.get(DOC_STORE, docKey)
    if (v !== undefined) {
      return mergeRateSettings(v as Partial<RateSettings>, defaults)
    }
    const raw = consumeLegacyLocalStorageRaw(DOC_KEYS.actualWorker)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<RateSettings>
        const merged = mergeRateSettings(parsed, defaults)
        await db.put(DOC_STORE, merged, docKey)
        return merged
      } catch {
        return defaults
      }
    }
    return defaults
  } catch {
    return defaults
  }
}

export async function saveActualWorkerRateSettingsToIdb(settings: RateSettings): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await db.put(DOC_STORE, settings, DOC_KEYS.actualWorker)
}

export async function clearActualWorkerRateSettingsIdb(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await db.delete(DOC_STORE, DOC_KEYS.actualWorker)
}

export async function loadEmployeesFromIdb(): Promise<StoredEmployee[]> {
  if (typeof indexedDB === 'undefined') return []
  try {
    const db = await openDb()
    const docKey = DOC_KEYS.employees
    const v = await db.get(DOC_STORE, docKey)
    if (v !== undefined) {
      return sanitizeEmployees(v)
    }
    const raw = consumeLegacyLocalStorageRaw(DOC_KEYS.employees)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown
        const list = sanitizeEmployees(parsed)
        await db.put(DOC_STORE, list, docKey)
        return list
      } catch {
        return []
      }
    }
    return []
  } catch {
    return []
  }
}

export async function saveEmployeesToIdb(employees: StoredEmployee[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await db.put(DOC_STORE, employees, DOC_KEYS.employees)
}
