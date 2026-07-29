import { Router, type Response } from 'express'
import { and, desc, eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { WorkOrderPushSchedule } from '../db/schema'
import { readImileTokenFromRequest } from './imileAuth'
import { normalizeImileToken } from '../imile/shared'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz } from '../imile/ausTimezone'
import { listPushableSupplierPushConfigsByIds, parsePushConfigIds } from '../supplierPushConfigs'
import {
  computeUnprocessedTicketWindow,
  executeWorkOrderPush,
  hasWorkOrderPushImileToken,
  readWorkOrderPushImileToken,
} from '../feishu/workOrderPushScheduledPush'

export const workOrderPushRouter = Router()

// ─── 定时推送配置（按账号隔离，一个账号可有多条） ────────────────────────────────

type ScheduleBody = {
  weekdays?: unknown
  pushTimes?: unknown
  isEnabled?: unknown
  stationCode?: unknown
  pushConfigIds?: unknown
  mentionEnabled?: unknown
  imileToken?: unknown
}

type PublicWorkOrderPushSchedule = {
  id: string
  weekdays: WorkOrderPushSchedule['weekdays']
  pushTimes: WorkOrderPushSchedule['pushTimes']
  isEnabled: boolean
  stationCode: string
  pushConfigIds: string[]
  mentionEnabled: boolean
  regionCode: string | null
  updatedAt: Date
  hasImileToken: boolean
}

function isPushTimeSlot(v: unknown): v is { id: string; time: string } {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    typeof (v as { id?: unknown }).id === 'string' &&
    typeof (v as { time?: unknown }).time === 'string' &&
    /^\d{2}:\d{2}$/.test((v as { time: string }).time)
  )
}

function extractScheduleFields(body: ScheduleBody) {
  return {
    weekdays: Array.isArray(body.weekdays) ? body.weekdays : [],
    pushTimes: Array.isArray(body.pushTimes) ? body.pushTimes.filter(isPushTimeSlot) : [],
    isEnabled: body.isEnabled !== false,
    stationCode: typeof body.stationCode === 'string' ? body.stationCode.trim() : '',
    pushConfigIds: parsePushConfigIds(body.pushConfigIds),
    mentionEnabled: body.mentionEnabled === true,
  }
}

/** 保存/立刻推送前校验：所选 id 必须存在且已配置 Webhook。不做地域过滤，只按站点编码收窄工单查询范围 */
async function validateWorkOrderPushConfigIds(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return '请至少选择一个供应商'
  const pushable = await listPushableSupplierPushConfigsByIds(ids)
  if (pushable.length > 0) return null
  return '请至少选择一个已配置 Webhook 的供应商'
}

async function toPublicSchedule(
  row: WorkOrderPushSchedule,
  regionCode: string | null,
): Promise<PublicWorkOrderPushSchedule> {
  return {
    id: row.id,
    weekdays: row.weekdays,
    pushTimes: row.pushTimes,
    isEnabled: row.isEnabled,
    stationCode: row.stationCode,
    pushConfigIds: parsePushConfigIds(row.pushConfigIds),
    mentionEnabled: row.mentionEnabled,
    regionCode,
    updatedAt: row.updatedAt,
    hasImileToken: await hasWorkOrderPushImileToken(row),
  }
}

async function loadOwnScheduleRow(
  db: ReturnType<typeof getDb>,
  userId: string,
  id: string,
): Promise<WorkOrderPushSchedule | null> {
  const rows = await db
    .select()
    .from(schema.workOrderPushSchedules)
    .where(and(eq(schema.workOrderPushSchedules.id, id), eq(schema.workOrderPushSchedules.userId, userId)))
    .limit(1)
  return rows[0] ?? null
}

workOrderPushRouter.get('/schedules', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.workOrderPushSchedules)
      .where(eq(schema.workOrderPushSchedules.userId, userId))
      .orderBy(desc(schema.workOrderPushSchedules.createdAt))
    const data = await Promise.all(rows.map((row) => toPublicSchedule(row, req.authUser?.regionCode ?? null)))
    res.json({ ok: true, data })
  } catch {
    res.status(500).json({ ok: false, error: '读取工单推送配置失败' })
  }
})

workOrderPushRouter.post('/schedules', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  const body = req.body as ScheduleBody
  if (!Array.isArray(body.weekdays) || !Array.isArray(body.pushTimes)) {
    res.status(400).json({ ok: false, error: '缺少必填字段: weekdays, pushTimes' })
    return
  }
  const fields = extractScheduleFields(body)
  if (!fields.stationCode) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode' })
    return
  }

  const tokenFromBody = typeof body.imileToken === 'string' ? body.imileToken.trim() : ''
  const tokenFromHeader = readImileTokenFromRequest(req, body.imileToken)
  const nextImileToken = tokenFromBody || tokenFromHeader

  const willEnable = fields.isEnabled && fields.pushTimes.length > 0 && fields.weekdays.length > 0
  if (willEnable && !nextImileToken) {
    res.status(400).json({ ok: false, error: '启用定时推送需要 iMile token，请在全局设置中配置后重新保存' })
    return
  }

  try {
    if (fields.isEnabled) {
      const pushConfigError = await validateWorkOrderPushConfigIds(fields.pushConfigIds)
      if (pushConfigError) {
        res.status(400).json({ ok: false, error: pushConfigError })
        return
      }
    }

    const db = getDb()
    const [created] = await db
      .insert(schema.workOrderPushSchedules)
      .values({
        userId,
        weekdays: fields.weekdays,
        pushTimes: fields.pushTimes,
        isEnabled: fields.isEnabled,
        stationCode: fields.stationCode,
        pushConfigIds: fields.pushConfigIds,
        mentionEnabled: fields.mentionEnabled,
        imileToken: nextImileToken ? normalizeImileToken(nextImileToken) : null,
        updatedBy: userId,
      })
      .returning()
    res.json({ ok: true, data: await toPublicSchedule(created, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '新增工单推送配置失败' })
  }
})

workOrderPushRouter.put('/schedules/:id', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  const body = req.body as ScheduleBody
  if (!Array.isArray(body.weekdays) || !Array.isArray(body.pushTimes)) {
    res.status(400).json({ ok: false, error: '缺少必填字段: weekdays, pushTimes' })
    return
  }
  const fields = extractScheduleFields(body)
  if (!fields.stationCode) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode' })
    return
  }

  try {
    if (fields.isEnabled) {
      const pushConfigError = await validateWorkOrderPushConfigIds(fields.pushConfigIds)
      if (pushConfigError) {
        res.status(400).json({ ok: false, error: pushConfigError })
        return
      }
    }

    const db = getDb()
    const existing = await loadOwnScheduleRow(db, userId, String(req.params.id ?? '').trim())
    if (!existing) {
      res.status(404).json({ ok: false, error: '配置不存在' })
      return
    }

    const tokenFromBody = typeof body.imileToken === 'string' ? body.imileToken.trim() : ''
    const tokenFromHeader = readImileTokenFromRequest(req, body.imileToken)
    const nextImileToken = tokenFromBody || tokenFromHeader

    const willEnable = fields.isEnabled && fields.pushTimes.length > 0 && fields.weekdays.length > 0
    const existingToken = existing.imileToken?.trim() ?? ''
    if (willEnable && !nextImileToken && !existingToken) {
      res.status(400).json({ ok: false, error: '启用定时推送需要 iMile token，请在全局设置中配置后重新保存' })
      return
    }

    const [updated] = await db
      .update(schema.workOrderPushSchedules)
      .set({
        weekdays: fields.weekdays,
        pushTimes: fields.pushTimes,
        isEnabled: fields.isEnabled,
        stationCode: fields.stationCode,
        pushConfigIds: fields.pushConfigIds,
        mentionEnabled: fields.mentionEnabled,
        ...(nextImileToken ? { imileToken: normalizeImileToken(nextImileToken) } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.workOrderPushSchedules.id, existing.id))
      .returning()
    res.json({ ok: true, data: await toPublicSchedule(updated, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '保存工单推送配置失败' })
  }
})

workOrderPushRouter.delete('/schedules/:id', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  try {
    const db = getDb()
    const existing = await loadOwnScheduleRow(db, userId, String(req.params.id ?? '').trim())
    if (!existing) {
      res.status(404).json({ ok: false, error: '配置不存在' })
      return
    }
    await db.delete(schema.workOrderPushSchedules).where(eq(schema.workOrderPushSchedules.id, existing.id))
    res.json({ ok: true, data: null })
  } catch {
    res.status(500).json({ ok: false, error: '删除工单推送配置失败' })
  }
})

/** 立刻推送：按该条目已保存的供应商范围执行，不校验推送时间 */
workOrderPushRouter.post('/schedules/:id/push-now', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  try {
    const db = getDb()
    const schedule = await loadOwnScheduleRow(db, userId, String(req.params.id ?? '').trim())
    if (!schedule) {
      res.status(404).json({ ok: false, error: '配置不存在' })
      return
    }

    const stationCode = schedule.stationCode?.trim()
    if (!stationCode) {
      res.status(400).json({ ok: false, error: '该配置未设置站点' })
      return
    }

    const token = await readWorkOrderPushImileToken(schedule)
    if (!token) {
      res.status(400).json({ ok: false, error: '缺少 iMile token，请编辑该配置并重新保存' })
      return
    }

    const configs = await listPushableSupplierPushConfigsByIds(parsePushConfigIds(schedule.pushConfigIds))
    if (configs.length === 0) {
      res.status(400).json({ ok: false, error: '请先为该配置选择至少一个已配置 Webhook 的供应商' })
      return
    }

    const tz = resolveRegionTz(req.authUser?.regionCode)
    const { dateStr: baseDate, timeHHmm: pushTime } = getRegionNow(tz)
    const { startTime, endTime } = computeUnprocessedTicketWindow(tz)

    const result = await executeWorkOrderPush({
      token,
      stationCode,
      startTime,
      endTime,
      pushTime,
      baseDate,
      tz,
      configs,
      label: `[work-order-push/push-now schedule=${schedule.id}]`,
      mentionEnabled: schedule.mentionEnabled,
    })
    if ('error' in result) {
      res.status(502).json({ ok: false, error: result.error })
      return
    }
    res.json({ ok: true, data: result })
  } catch {
    res.status(500).json({ ok: false, error: '立刻推送失败' })
  }
})
