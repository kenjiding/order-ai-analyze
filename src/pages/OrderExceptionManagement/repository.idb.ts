import type { DBSchema } from 'idb'
import { createSingletonIdb } from '../../storage/createSingletonIdb'
import { stripHtmlToPlainText } from '../../utils/stripHtmlToPlainText'
import type { ExceptionCategoryEntity, ExceptionSampleEntity, TrackEvent } from './types'
import { normalizeLossScope } from './types'
import type { OrderExceptionRepository } from './repository.contract'

const DB_NAME = 'warehouse-order-exception'
const DB_VERSION = 1
const CAT_STORE = 'exceptionCategories'
const SAMPLE_STORE = 'exceptionSamples'

type OrderExceptionDb = DBSchema & {
  [CAT_STORE]: {
    key: string
    value: ExceptionCategoryEntity
    indexes: { byUpdatedAt: string; byCreatedAt: string }
  }
  [SAMPLE_STORE]: {
    key: string
    value: ExceptionSampleEntity
    indexes: {
      byCategoryId: string
      byOrderNo: string
      byFetchedAt: string
    }
  }
}

const openDb = createSingletonIdb<OrderExceptionDb>({
  name: DB_NAME,
  version: DB_VERSION,
  upgrade(db) {
    if (!db.objectStoreNames.contains(CAT_STORE)) {
      const cat = db.createObjectStore(CAT_STORE, { keyPath: 'id' })
      cat.createIndex('byCreatedAt', 'createdAt')
      cat.createIndex('byUpdatedAt', 'updatedAt')
    }
    if (!db.objectStoreNames.contains(SAMPLE_STORE)) {
      const sm = db.createObjectStore(SAMPLE_STORE, { keyPath: 'id' })
      sm.createIndex('byCategoryId', 'categoryId')
      sm.createIndex('byOrderNo', 'orderNo')
      sm.createIndex('byFetchedAt', 'fetchedAt')
    }
  },
})

function normalizeCategoryRow(raw: ExceptionCategoryEntity): ExceptionCategoryEntity {
  return {
    ...raw,
    description: typeof raw.description === 'string' ? raw.description : '',
    lossScope: normalizeLossScope(raw.lossScope),
  }
}

function stripTrackHtml(tracks: TrackEvent[]): TrackEvent[] {
  return tracks.map((t) => ({
    ...t,
    content: stripHtmlToPlainText(t.content),
    ...(t.trackStageTx !== undefined
      ? { trackStageTx: stripHtmlToPlainText(String(t.trackStageTx)) || undefined }
      : {}),
  }))
}

export function createIndexedDbOrderExceptionRepository(): OrderExceptionRepository {
  return {
    async listCategories() {
      const db = await openDb()
      const all = await db.getAll(CAT_STORE)
      return all.map(normalizeCategoryRow).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    async createCategory(name, description, lossScope) {
      const db = await openDb()
      const now = new Date().toISOString()
      const row: ExceptionCategoryEntity = {
        id: crypto.randomUUID(),
        name: name.trim(),
        description: description.trim(),
        lossScope,
        createdAt: now,
        updatedAt: now,
      }
      await db.put(CAT_STORE, row)
      return row
    },

    async updateCategory(id, patch) {
      const db = await openDb()
      const prev = await db.get(CAT_STORE, id)
      if (!prev) throw new Error('分类不存在')
      const base = normalizeCategoryRow(prev)
      const next: ExceptionCategoryEntity = {
        ...base,
        name: patch.name?.trim() ?? base.name,
        description:
          patch.description !== undefined ? patch.description.trim() : base.description,
        lossScope:
          patch.lossScope !== undefined ? normalizeLossScope(patch.lossScope) : base.lossScope,
        updatedAt: new Date().toISOString(),
      }
      await db.put(CAT_STORE, next)
    },

    async deleteCategory(id) {
      const db = await openDb()
      const tx = db.transaction([CAT_STORE, SAMPLE_STORE], 'readwrite')
      const sampleStore = tx.objectStore(SAMPLE_STORE)
      let cursor = await sampleStore.index('byCategoryId').openCursor(IDBKeyRange.only(id))
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
      await tx.objectStore(CAT_STORE).delete(id)
      await tx.done
    },

    async listSamplesByCategory(categoryId) {
      const db = await openDb()
      const list = await db.getAllFromIndex(SAMPLE_STORE, 'byCategoryId', categoryId)
      return list.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))
    },

    async upsertSample(input: { categoryId: string; orderNo: string; tracks: TrackEvent[] }) {
      const db = await openDb()
      const orderNo = input.orderNo.trim()
      if (!orderNo) throw new Error('订单号为空')
      const now = new Date().toISOString()
      const existingAll = await db.getAllFromIndex(SAMPLE_STORE, 'byCategoryId', input.categoryId)
      const found = existingAll.find((s) => s.orderNo === orderNo)
      if (found) {
        const next: ExceptionSampleEntity = {
          ...found,
          tracks: stripTrackHtml(input.tracks),
          fetchedAt: now,
        }
        await db.put(SAMPLE_STORE, next)
        return next
      }
      const row: ExceptionSampleEntity = {
        id: crypto.randomUUID(),
        categoryId: input.categoryId,
        orderNo,
        tracks: stripTrackHtml(input.tracks),
        fetchedAt: now,
      }
      await db.put(SAMPLE_STORE, row)
      return row
    },

    async updateSampleTracks(sampleId, tracks) {
      const db = await openDb()
      const prev = await db.get(SAMPLE_STORE, sampleId)
      if (!prev) throw new Error('样本不存在')
      const next: ExceptionSampleEntity = {
        ...prev,
        tracks: stripTrackHtml(tracks),
      }
      await db.put(SAMPLE_STORE, next)
      return next
    },

    async listAllSamples() {
      const db = await openDb()
      return db.getAll(SAMPLE_STORE)
    },

    async deleteSample(sampleId) {
      const db = await openDb()
      await db.delete(SAMPLE_STORE, sampleId)
    },
  }
}
