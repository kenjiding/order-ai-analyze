import { Router, type Response } from 'express'
import { and, desc, eq, gte, ilike, lte } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { AttendanceWorkRecord } from '../db/schema'
import { parseOptionalRegionFilter, resolveEnqueueRegionCode } from '../jobs/access'
import { isValidAttendanceProcessCategory, isValidAttendanceShift } from '../attendanceWorkTime/constants'
import { SUPER_ADMIN_ROLE } from '../permissions/registry'

export const attendanceWorkTimeRouter = Router()

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

type PublicAttendanceRecord = {
  id: string
  regionCode: string
  workerId: string
  workerName: string
  processCategory: string
  shift: string
  zoneCode: string | null
  startTime: Date
  endTime: Date | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

function toPublicRecord(row: AttendanceWorkRecord & { workerName: string }): PublicAttendanceRecord {
  return {
    id: row.id,
    regionCode: row.regionCode,
    workerId: row.workerId,
    workerName: row.workerName,
    processCategory: row.processCategory,
    shift: row.shift,
    zoneCode: row.zoneCode,
    startTime: row.startTime,
    endTime: row.endTime,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** 同区域按姓名精确查找人员；不存在则创建。并发下用唯一索引 + onConflictDoNothing 兜底，不加应用层锁 */
async function findOrCreateWorkerId(tx: Tx, regionCode: string, rawName: string): Promise<string> {
  const name = rawName.trim()
  const existing = await tx
    .select({ id: schema.attendanceWorkers.id })
    .from(schema.attendanceWorkers)
    .where(and(eq(schema.attendanceWorkers.regionCode, regionCode), eq(schema.attendanceWorkers.name, name)))
    .limit(1)
  if (existing[0]) return existing[0].id

  const inserted = await tx
    .insert(schema.attendanceWorkers)
    .values({ regionCode, name })
    .onConflictDoNothing({ target: [schema.attendanceWorkers.regionCode, schema.attendanceWorkers.name] })
    .returning({ id: schema.attendanceWorkers.id })
  if (inserted[0]) return inserted[0].id

  const retry = await tx
    .select({ id: schema.attendanceWorkers.id })
    .from(schema.attendanceWorkers)
    .where(and(eq(schema.attendanceWorkers.regionCode, regionCode), eq(schema.attendanceWorkers.name, name)))
    .limit(1)
  if (!retry[0]) throw new Error('创建人员失败')
  return retry[0].id
}

type RecordBody = {
  regionCode?: unknown
  workerName?: unknown
  processCategory?: unknown
  shift?: unknown
  zoneCode?: unknown
  startTime?: unknown
  endTime?: unknown
  notes?: unknown
}

function parseRecordBody(body: RecordBody): { workerName: string; processCategory: string; shift: string; zoneCode: string | null; startTime: Date; endTime: Date | null; notes: string | null } | string {
  const workerName = String(body.workerName ?? '').trim()
  if (!workerName) return '人员姓名不能为空'

  const processCategory = String(body.processCategory ?? '').trim()
  if (!isValidAttendanceProcessCategory(processCategory)) return '工序不合法'

  const shift = String(body.shift ?? '').trim()
  if (!isValidAttendanceShift(shift)) return '班次不合法'

  const startTime = new Date(String(body.startTime ?? ''))
  if (Number.isNaN(startTime.getTime())) return '开始时间格式不正确'

  const endTimeRaw = String(body.endTime ?? '').trim()
  let endTime: Date | null = null
  if (endTimeRaw) {
    endTime = new Date(endTimeRaw)
    if (Number.isNaN(endTime.getTime())) return '结束时间格式不正确'
    if (endTime.getTime() <= startTime.getTime()) return '结束时间必须晚于开始时间'
  }

  const zoneCode = body.zoneCode == null ? null : String(body.zoneCode).trim() || null
  const notes = body.notes == null ? null : String(body.notes).trim() || null

  return { workerName, processCategory, shift, zoneCode, startTime, endTime, notes }
}

// GET /api/attendance-work-time/workers/suggest?q=&region=
attendanceWorkTimeRouter.get('/workers/suggest', async (req: AuthenticatedRequest, res: Response) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) {
    res.json({ ok: true, data: [] })
    return
  }
  const regionResult = parseOptionalRegionFilter(req, req.query.region)
  if (regionResult === 'forbidden') {
    res.status(403).json({ ok: false, error: '无权访问该州/区域数据' })
    return
  }
  if (regionResult === 'invalid') {
    res.status(400).json({ ok: false, error: '无效的州/区域' })
    return
  }
  try {
    const db = getDb()
    const conditions = [ilike(schema.attendanceWorkers.name, `%${q}%`)]
    if (regionResult) conditions.push(eq(schema.attendanceWorkers.regionCode, regionResult))
    const rows = await db
      .select({ id: schema.attendanceWorkers.id, name: schema.attendanceWorkers.name, regionCode: schema.attendanceWorkers.regionCode })
      .from(schema.attendanceWorkers)
      .where(and(...conditions))
      .orderBy(schema.attendanceWorkers.name)
      .limit(20)
    res.json({ ok: true, data: rows })
  } catch {
    res.status(500).json({ ok: false, error: '搜索人员失败' })
  }
})

// GET /api/attendance-work-time/records?region=&startDate=&endDate=
attendanceWorkTimeRouter.get('/records', async (req: AuthenticatedRequest, res: Response) => {
  const regionResult = parseOptionalRegionFilter(req, req.query.region)
  if (regionResult === 'forbidden') {
    res.status(403).json({ ok: false, error: '无权访问该州/区域数据' })
    return
  }
  if (regionResult === 'invalid') {
    res.status(400).json({ ok: false, error: '无效的州/区域' })
    return
  }
  try {
    const db = getDb()
    const conditions = []
    if (regionResult) conditions.push(eq(schema.attendanceWorkRecords.regionCode, regionResult))

    const startDateRaw = String(req.query.startDate ?? '').trim()
    if (startDateRaw) {
      const startDate = new Date(startDateRaw)
      if (!Number.isNaN(startDate.getTime())) conditions.push(gte(schema.attendanceWorkRecords.startTime, startDate))
    }
    const endDateRaw = String(req.query.endDate ?? '').trim()
    if (endDateRaw) {
      const endDate = new Date(endDateRaw)
      if (!Number.isNaN(endDate.getTime())) conditions.push(lte(schema.attendanceWorkRecords.startTime, endDate))
    }

    const rows = await db
      .select({
        id: schema.attendanceWorkRecords.id,
        regionCode: schema.attendanceWorkRecords.regionCode,
        workerId: schema.attendanceWorkRecords.workerId,
        workerName: schema.attendanceWorkers.name,
        processCategory: schema.attendanceWorkRecords.processCategory,
        shift: schema.attendanceWorkRecords.shift,
        zoneCode: schema.attendanceWorkRecords.zoneCode,
        startTime: schema.attendanceWorkRecords.startTime,
        endTime: schema.attendanceWorkRecords.endTime,
        notes: schema.attendanceWorkRecords.notes,
        createdAt: schema.attendanceWorkRecords.createdAt,
        updatedAt: schema.attendanceWorkRecords.updatedAt,
      })
      .from(schema.attendanceWorkRecords)
      .innerJoin(schema.attendanceWorkers, eq(schema.attendanceWorkRecords.workerId, schema.attendanceWorkers.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.attendanceWorkRecords.startTime))
      .limit(500)
    res.json({ ok: true, data: rows })
  } catch {
    res.status(500).json({ ok: false, error: '读取出勤记录失败' })
  }
})

// POST /api/attendance-work-time/records
attendanceWorkTimeRouter.post('/records', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as RecordBody
  const parsed = parseRecordBody(body)
  if (typeof parsed === 'string') {
    res.status(400).json({ ok: false, error: parsed })
    return
  }

  const regionResult = resolveEnqueueRegionCode(req, body.regionCode)
  if (regionResult === 'forbidden') {
    res.status(403).json({ ok: false, error: '无权在该州/区域创建记录' })
    return
  }
  if (regionResult === 'invalid') {
    res.status(400).json({ ok: false, error: '无效的州/区域' })
    return
  }
  if (!regionResult) {
    res.status(400).json({ ok: false, error: '请选择记录所属州/区域' })
    return
  }

  try {
    const db = getDb()
    const row = await db.transaction(async (tx) => {
      const workerId = await findOrCreateWorkerId(tx, regionResult, parsed.workerName)
      const [inserted] = await tx
        .insert(schema.attendanceWorkRecords)
        .values({
          regionCode: regionResult,
          workerId,
          processCategory: parsed.processCategory,
          shift: parsed.shift,
          zoneCode: parsed.zoneCode,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          notes: parsed.notes,
          createdBy: req.authUser?.id ?? null,
        })
        .returning()
      return { ...inserted, workerName: parsed.workerName }
    })
    res.status(201).json({ ok: true, data: toPublicRecord(row) })
  } catch {
    res.status(500).json({ ok: false, error: '创建出勤记录失败' })
  }
})

async function loadRecordRegionCode(id: string): Promise<string | null> {
  const db = getDb()
  const rows = await db
    .select({ regionCode: schema.attendanceWorkRecords.regionCode })
    .from(schema.attendanceWorkRecords)
    .where(eq(schema.attendanceWorkRecords.id, id))
    .limit(1)
  return rows[0]?.regionCode ?? null
}

function canAccessAttendanceRecord(req: AuthenticatedRequest, recordRegionCode: string): boolean {
  const user = req.authUser
  if (!user) return false
  if (user.role === SUPER_ADMIN_ROLE) return true
  return user.regionCode === recordRegionCode
}

// PUT /api/attendance-work-time/records/:id
attendanceWorkTimeRouter.put('/records/:id', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  const body = req.body as RecordBody
  const parsed = parseRecordBody(body)
  if (typeof parsed === 'string') {
    res.status(400).json({ ok: false, error: parsed })
    return
  }

  try {
    const existingRegionCode = await loadRecordRegionCode(id)
    if (!existingRegionCode) {
      res.status(404).json({ ok: false, error: '记录不存在' })
      return
    }
    if (!canAccessAttendanceRecord(req, existingRegionCode)) {
      res.status(403).json({ ok: false, error: '无权编辑该记录' })
      return
    }

    const db = getDb()
    const row = await db.transaction(async (tx) => {
      const workerId = await findOrCreateWorkerId(tx, existingRegionCode, parsed.workerName)
      const [updated] = await tx
        .update(schema.attendanceWorkRecords)
        .set({
          workerId,
          processCategory: parsed.processCategory,
          shift: parsed.shift,
          zoneCode: parsed.zoneCode,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          notes: parsed.notes,
          updatedAt: new Date(),
        })
        .where(eq(schema.attendanceWorkRecords.id, id))
        .returning()
      return { ...updated, workerName: parsed.workerName }
    })
    res.json({ ok: true, data: toPublicRecord(row) })
  } catch {
    res.status(500).json({ ok: false, error: '更新出勤记录失败' })
  }
})

// DELETE /api/attendance-work-time/records/:id
attendanceWorkTimeRouter.delete('/records/:id', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  try {
    const existingRegionCode = await loadRecordRegionCode(id)
    if (!existingRegionCode) {
      res.status(404).json({ ok: false, error: '记录不存在' })
      return
    }
    if (!canAccessAttendanceRecord(req, existingRegionCode)) {
      res.status(403).json({ ok: false, error: '无权删除该记录' })
      return
    }
    const db = getDb()
    await db.delete(schema.attendanceWorkRecords).where(eq(schema.attendanceWorkRecords.id, id))
    res.json({ ok: true })
  } catch {
    res.status(500).json({ ok: false, error: '删除出勤记录失败' })
  }
})
