import type { DBSchema } from 'idb'
import { createSingletonIdb } from '../../storage/createSingletonIdb'
import {
  normalizeAttendanceSchedulingPushTemplate,
  toAttendanceSchedulingPushTemplatePayload,
  type AttendanceSchedulingPushTemplate,
  type AttendanceSchedulingPushTemplateStoredV1,
} from './attendanceSchedulingPushTemplateStorage'

const DB_NAME = 'warehouse-attendance-scheduling-push-template'
const DB_VERSION = 1
const DOC_STORE = 'attendanceSchedulingPushTemplateDocs'
const DOC_KEY = 'template.v1'

type AttendanceSchedulingPushTemplateDb = DBSchema & {
  [DOC_STORE]: {
    key: string
    value: AttendanceSchedulingPushTemplateStoredV1
  }
}

const openDb = createSingletonIdb<AttendanceSchedulingPushTemplateDb>({
  name: DB_NAME,
  version: DB_VERSION,
  upgrade(db) {
    if (!db.objectStoreNames.contains(DOC_STORE)) {
      db.createObjectStore(DOC_STORE)
    }
  },
})

export async function loadAttendanceSchedulingPushTemplate(): Promise<AttendanceSchedulingPushTemplate | null> {
  if (typeof indexedDB === 'undefined') return null

  try {
    const db = await openDb()
    const row = await db.get(DOC_STORE, DOC_KEY)
    if (row === undefined) return null
    return normalizeAttendanceSchedulingPushTemplate(row)
  } catch {
    return null
  }
}

export async function persistAttendanceSchedulingPushTemplate(
  template: AttendanceSchedulingPushTemplate,
): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB 不可用')
  }
  const db = await openDb()
  await db.put(DOC_STORE, toAttendanceSchedulingPushTemplatePayload(template), DOC_KEY)
}
