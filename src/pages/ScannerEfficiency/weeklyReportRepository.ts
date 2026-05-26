import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { SortEfficiencyPushDayRecord } from './feishuSortEfficiencySnapshot'
import {
  addDaysToDateKey,
  getPreviousWeeklyPeriod,
  type WeeklyReportSnapshot,
} from './weeklyReportSnapshot'

export type WeeklyMailCcPrefsDocument = {
  id: 'default'
  /** 最近使用的抄送文案（整块输入） */
  lastCc: string
  /** 去重后的历史记录，新近在前 */
  ccHistory: string[]
}

export type WeeklyReportRepository = {
  save(snapshot: WeeklyReportSnapshot): Promise<void>
  findPreviousSnapshot(periodStart: string, periodEnd: string): Promise<WeeklyReportSnapshot | null>
  pruneExpired(now?: Date): Promise<void>
  getMailCcPrefs(): Promise<WeeklyMailCcPrefsDocument>
  mergeMailCcAfterGenerate(ccRaw: string): Promise<WeeklyMailCcPrefsDocument>
}

const DB_NAME = 'warehouse-efficiency'
const DB_VERSION = 3
const STORE_NAME = 'weeklyReportSnapshots'
const MAIL_PREFS_STORE = 'weeklyMailPrefs'
const PUSH_DAY_SNAPSHOT_STORE = 'sortEfficiencyPushDaySnapshots'
const MAIL_PREFS_DEFAULT_ID = 'default' as const
const CC_HISTORY_MAX = 40

type WarehouseEfficiencyDb = DBSchema & {
  weeklyReportSnapshots: {
    key: string
    value: WeeklyReportSnapshot
    indexes: {
      periodStart: string
      periodEnd: string
      expiresAt: string
      generatedAt: string
    }
  }
  weeklyMailPrefs: {
    key: string
    value: WeeklyMailCcPrefsDocument
  }
  sortEfficiencyPushDaySnapshots: {
    key: string
    value: SortEfficiencyPushDayRecord
  }
}

let sharedWarehouseEfficiencyDbPromise: Promise<IDBPDatabase<WarehouseEfficiencyDb>> | null = null

/** 与周报共用 `warehouse-efficiency` 库；供按日推送快照等复用 */
export function openWarehouseEfficiencyDb(): Promise<IDBPDatabase<WarehouseEfficiencyDb>> {
  if (!sharedWarehouseEfficiencyDbPromise) {
    sharedWarehouseEfficiencyDbPromise = openDB<WarehouseEfficiencyDb>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? transaction.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: 'id' })

        if (!store.indexNames.contains('periodStart')) store.createIndex('periodStart', 'periodStart')
        if (!store.indexNames.contains('periodEnd')) store.createIndex('periodEnd', 'periodEnd')
        if (!store.indexNames.contains('expiresAt')) store.createIndex('expiresAt', 'expiresAt')
        if (!store.indexNames.contains('generatedAt')) store.createIndex('generatedAt', 'generatedAt')

        if (!db.objectStoreNames.contains(MAIL_PREFS_STORE)) {
          db.createObjectStore(MAIL_PREFS_STORE, { keyPath: 'id' })
        }

        if (!db.objectStoreNames.contains(PUSH_DAY_SNAPSHOT_STORE)) {
          db.createObjectStore(PUSH_DAY_SNAPSHOT_STORE, { keyPath: 'dateKey' })
        }
      },
    })
  }

  return sharedWarehouseEfficiencyDbPromise
}

const sortByLatestGeneratedAt = (a: WeeklyReportSnapshot, b: WeeklyReportSnapshot): number =>
  b.generatedAt.localeCompare(a.generatedAt)

const emptyMailCcPrefs = (): WeeklyMailCcPrefsDocument => ({
  id: MAIL_PREFS_DEFAULT_ID,
  lastCc: '',
  ccHistory: [],
})

class IndexedDbWeeklyReportRepository implements WeeklyReportRepository {
  async save(snapshot: WeeklyReportSnapshot): Promise<void> {
    const db = await openWarehouseEfficiencyDb()
    await db.put(STORE_NAME, snapshot)
  }

  async findPreviousSnapshot(periodStart: string, periodEnd: string): Promise<WeeklyReportSnapshot | null> {
    const { periodStart: expectedStart, periodEnd: expectedEnd } = getPreviousWeeklyPeriod(periodStart, periodEnd)
    const snapshots = await this.getAllSnapshots()
    const exactMatch = snapshots
      .filter((snapshot) => snapshot.periodStart === expectedStart && snapshot.periodEnd === expectedEnd)
      .sort(sortByLatestGeneratedAt)[0]

    if (exactMatch) return exactMatch

    const earliestFallbackStart = addDaysToDateKey(periodStart, -14)
    return (
      snapshots
        .filter(
          (snapshot) =>
            snapshot.periodEnd < periodStart &&
            snapshot.periodStart >= earliestFallbackStart &&
            snapshot.periodEnd <= expectedEnd,
        )
        .sort((a, b) => {
          const periodOrder = b.periodEnd.localeCompare(a.periodEnd)
          return periodOrder || sortByLatestGeneratedAt(a, b)
        })[0] ?? null
    )
  }

  async pruneExpired(now = new Date()): Promise<void> {
    const db = await openWarehouseEfficiencyDb()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const index = transaction.store.index('expiresAt')
    let cursor = await index.openCursor(IDBKeyRange.upperBound(now.toISOString()))

    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }

    await transaction.done
  }

  private async getAllSnapshots(): Promise<WeeklyReportSnapshot[]> {
    const db = await openWarehouseEfficiencyDb()
    return db.getAll(STORE_NAME)
  }

  async getMailCcPrefs(): Promise<WeeklyMailCcPrefsDocument> {
    const db = await openWarehouseEfficiencyDb()
    const row = await db.get(MAIL_PREFS_STORE, MAIL_PREFS_DEFAULT_ID)
    return row ?? emptyMailCcPrefs()
  }

  async mergeMailCcAfterGenerate(ccRaw: string): Promise<WeeklyMailCcPrefsDocument> {
    const normalized = ccRaw.trim().replace(/\s*,\s*/g, ', ')
    const db = await openWarehouseEfficiencyDb()
    const existing = await this.getMailCcPrefs()
    let nextHistory = [...existing.ccHistory]
    if (normalized) {
      const lower = normalized.toLowerCase()
      nextHistory = nextHistory.filter((entry) => entry.toLowerCase() !== lower)
      nextHistory.unshift(normalized)
      nextHistory = nextHistory.slice(0, CC_HISTORY_MAX)
    }
    const doc: WeeklyMailCcPrefsDocument = {
      id: MAIL_PREFS_DEFAULT_ID,
      lastCc: normalized,
      ccHistory: nextHistory,
    }
    await db.put(MAIL_PREFS_STORE, doc)
    return doc
  }
}

let weeklyReportRepository: WeeklyReportRepository | null = null

export function getWeeklyReportRepository(): WeeklyReportRepository | null {
  if (typeof indexedDB === 'undefined') return null
  if (!weeklyReportRepository) {
    weeklyReportRepository = new IndexedDbWeeklyReportRepository()
  }
  return weeklyReportRepository
}
