import { generateId } from '../../utils/generateId'
import type { FeishuPushEntry, FeishuPushKind } from './feishuPushTypes'

/** 历史 localStorage 键：`feishuPushRepository.idb` 首次读取时会迁移并删除。 */
export const FEISHU_PUSH_STORAGE_KEY = 'warehouse.feishuPushConfigs.v1'

export type FeishuPushStoredShapeV1 = {
  v: 1
  byKind: Record<string, unknown>
}

function dedupeMergeEntryLists(arrays: FeishuPushEntry[][]): FeishuPushEntry[] {
  const seen = new Set<string>()
  const out: FeishuPushEntry[] = []
  for (const arr of arrays) {
    for (const e of arr) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      out.push(e)
    }
  }
  return out
}

/** 旧版本中存在的分桶字段（已废弃，读出后合并写入 sort_efficiency） */
function legacyBucketsPresent(byKind: object): boolean {
  return (
    Object.prototype.hasOwnProperty.call(byKind, 'level1_sort_efficiency') ||
    Object.prototype.hasOwnProperty.call(byKind, 'overall_efficiency')
  )
}

export function createPushEntryId(): string {
  return generateId()
}

export function sanitizeEntries(raw: unknown): FeishuPushEntry[] {
  if (!Array.isArray(raw)) return []
  const out: FeishuPushEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id ? o.id : createPushEntryId()
    const webhookUrl = typeof o.webhookUrl === 'string' ? o.webhookUrl.trim() : ''
    const pushName = typeof o.pushName === 'string' ? o.pushName.trim() : ''
    const pushTimeHm = typeof o.pushTimeHm === 'string' ? o.pushTimeHm.trim() : ''
    const signingSecret =
      typeof o.signingSecret === 'string' && o.signingSecret.trim() !== '' ? o.signingSecret.trim() : undefined
    const isDisabled = o.isDisabled === true
    const pushDescription =
      typeof o.pushDescription === 'string' && o.pushDescription.trim() !== ''
        ? o.pushDescription.trim()
        : undefined
    out.push({
      id,
      webhookUrl,
      pushName,
      pushTimeHm,
      isDisabled,
      signingSecret,
      pushDescription,
    })
  }
  return out
}

export type FeishuPushStore = Record<FeishuPushKind, FeishuPushEntry[]>

export function emptyFeishuPushStore(): FeishuPushStore {
  return { sort_efficiency: [], attendance_scheduling: [], order_exception: [] }
}

export function toFeishuPushStoredPayload(store: FeishuPushStore): FeishuPushStoredShapeV1 {
  return {
    v: 1,
    byKind: {
      sort_efficiency: store.sort_efficiency,
      attendance_scheduling: store.attendance_scheduling,
      order_exception: store.order_exception,
    },
  }
}

/**
 * 解析已存储的 JSON（IndexedDB 对象或 localStorage 解析结果）。
 * `needsCanonicalResave` 为 true 时应写回规范形态（去掉废弃分桶字段）。
 */
export function normalizeFeishuPushFromParsed(parsed: unknown): {
  store: FeishuPushStore
  needsCanonicalResave: boolean
} {
  const empty = emptyFeishuPushStore()
  if (!parsed || typeof parsed !== 'object') return { store: empty, needsCanonicalResave: false }
  const v = parsed as FeishuPushStoredShapeV1
  if (v.v !== 1 || !v.byKind || typeof v.byKind !== 'object') {
    return { store: empty, needsCanonicalResave: false }
  }
  const { byKind } = v
  const sort = sanitizeEntries(byKind.sort_efficiency)
  const attendanceScheduling = sanitizeEntries(byKind.attendance_scheduling)
  const orderException = sanitizeEntries(byKind.order_exception)
  const legacyA = sanitizeEntries(byKind.level1_sort_efficiency)
  const legacyB = sanitizeEntries(byKind.overall_efficiency)
  const merged = dedupeMergeEntryLists([sort, legacyA, legacyB])
  return {
    store: { sort_efficiency: merged, attendance_scheduling: attendanceScheduling, order_exception: orderException },
    needsCanonicalResave: legacyBucketsPresent(byKind),
  }
}
