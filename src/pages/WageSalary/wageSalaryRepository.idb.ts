import type { DBSchema } from 'idb'
import { createSingletonIdb } from '../../storage/createSingletonIdb'
import type { StoredEmployee } from './storage'

const DB_NAME = 'warehouse-wage-salary'
const DB_VERSION = 1
const DOC_STORE = 'wageSalaryDocs'

const DOC_KEYS = {
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

function sanitizeEmployees(raw: unknown): StoredEmployee[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (x) => x && typeof x === 'object' && typeof (x as StoredEmployee).employeeId === 'string',
  ) as StoredEmployee[]
}

export async function loadEmployeesFromIdb(): Promise<StoredEmployee[]> {
  if (typeof indexedDB === 'undefined') return []
  try {
    const db = await openDb()
    const v = await db.get(DOC_STORE, DOC_KEYS.employees)
    return v !== undefined ? sanitizeEmployees(v) : []
  } catch {
    return []
  }
}

export async function saveEmployeesToIdb(employees: StoredEmployee[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await db.put(DOC_STORE, employees, DOC_KEYS.employees)
}
