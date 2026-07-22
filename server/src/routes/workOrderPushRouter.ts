import { Router, type Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { WorkOrderPushSchedule } from '../db/schema'
import { readImileTokenFromRequest } from './imileAuth'
import { normalizeImileToken } from '../imile/shared'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz } from '../imile/ausTimezone'
import { listPushableSupplierPushConfigsByIds, parsePushConfigIds } from '../supplierPushConfigs'
import { workOrderPushScheduledScope } from '../supplierConfigScopes/workOrderPushScheduled'
import {
  computeUnprocessedTicketWindow,
  executeWorkOrderPush,
  hasWorkOrderPushImileToken,
} from '../feishu/workOrderPushScheduledPush'

export const workOrderPushRouter = Router()

// ─── 定时推送配置（按账号隔离，每个账号最多一条） ────────────────────────────────

type ScheduleBody = {
  pushTimes?: unknown
  isEnabled?: unknown
  imileToken?: unknown
}

type PublicWorkOrderPushSchedule = {
  id: string
  pushTimes: WorkOrderPushSchedule['pushTimes']
  isEnabled: boolean
  regionCode: string | null
  pushConfigIds: string[]
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

async function toPublicSchedule(
  row: WorkOrderPushSchedule,
  regionCode: string | null,
): Promise<PublicWorkOrderPushSchedule> {
  const pushConfigIds = await workOrderPushScheduledScope.loadEnabledConfigIds()
  return {
    id: row.id,
    pushTimes: row.pushTimes,
    isEnabled: row.isEnabled,
    regionCode,
    pushConfigIds,
    updatedAt: row.updatedAt,
    hasImileToken: hasWorkOrderPushImileToken(row),
  }
}

async function loadOwnScheduleRow(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<WorkOrderPushSchedule | null> {
  const rows = await db
    .select()
    .from(schema.workOrderPushSchedules)
    .where(eq(schema.workOrderPushSchedules.userId, userId))
    .limit(1)
  return rows[0] ?? null
}

workOrderPushRouter.get('/schedule', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  try {
    const db = getDb()
    const row = await loadOwnScheduleRow(db, userId)
    res.json({ ok: true, data: row ? await toPublicSchedule(row, req.authUser?.regionCode ?? null) : null })
  } catch {
    res.status(500).json({ ok: false, error: '读取定时配置失败' })
  }
})

workOrderPushRouter.put('/schedule', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  const body = req.body as ScheduleBody
  if (!Array.isArray(body.pushTimes)) {
    res.status(400).json({ ok: false, error: '缺少必填字段: pushTimes' })
    return
  }
  const pushTimes = body.pushTimes.filter(isPushTimeSlot)
  try {
    const db = getDb()
    const existing = await loadOwnScheduleRow(db, userId)

    const tokenFromBody = typeof body.imileToken === 'string' ? body.imileToken.trim() : ''
    const tokenFromHeader = readImileTokenFromRequest(req, body.imileToken)
    const nextImileToken = tokenFromBody || tokenFromHeader

    const isEnabled = body.isEnabled !== false
    const willEnable = isEnabled && pushTimes.length > 0
    const existingToken = existing?.imileToken?.trim() ?? ''
    if (willEnable && !nextImileToken && !existingToken && !hasWorkOrderPushImileToken(existing)) {
      res.status(400).json({
        ok: false,
        error: '启用定时推送需要 iMile token，请在全局设置中配置后重新保存',
      })
      return
    }

    let row: WorkOrderPushSchedule
    if (existing) {
      const [updated] = await db
        .update(schema.workOrderPushSchedules)
        .set({
          pushTimes,
          isEnabled,
          ...(nextImileToken ? { imileToken: normalizeImileToken(nextImileToken) } : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.workOrderPushSchedules.id, existing.id))
        .returning()
      row = updated
    } else {
      const [created] = await db
        .insert(schema.workOrderPushSchedules)
        .values({
          userId,
          pushTimes,
          isEnabled,
          imileToken: nextImileToken ? normalizeImileToken(nextImileToken) : null,
          updatedBy: userId,
        })
        .returning()
      row = created
    }
    res.json({ ok: true, data: await toPublicSchedule(row, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '保存定时配置失败' })
  }
})

workOrderPushRouter.put('/schedule/push-config-ids', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  const body = req.body as { pushConfigIds?: unknown }
  const pushConfigIds = parsePushConfigIds(body.pushConfigIds)
  try {
    await workOrderPushScheduledScope.saveEnabledConfigIds(pushConfigIds)
    const db = getDb()
    const row = await loadOwnScheduleRow(db, userId)
    if (!row) {
      res.status(500).json({ ok: false, error: '保存定时推送供应商失败' })
      return
    }
    res.json({ ok: true, data: await toPublicSchedule(row, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '保存定时推送供应商失败' })
  }
})

// ─── 立即推送工单提醒 ─────────────────────────────────────────────────────────

workOrderPushRouter.post('/push-now', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  type PushNowBody = { configIds?: unknown }
  const body = req.body as PushNowBody

  const configIds = Array.isArray(body.configIds)
    ? body.configIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    : []
  if (configIds.length === 0) {
    res.status(400).json({ ok: false, error: '请至少选择一个供应商配置' })
    return
  }

  const configs = await listPushableSupplierPushConfigsByIds(configIds)
  if (configs.length === 0) {
    res.status(400).json({ ok: false, error: '所选供应商均不可用（未配置 Webhook）' })
    return
  }

  const tz = resolveRegionTz(req.authUser?.regionCode)
  const { dateStr: baseDate, timeHHmm: pushTime } = getRegionNow(tz)
  const { startTime, endTime } = computeUnprocessedTicketWindow(tz)

  const result = await executeWorkOrderPush({
    token,
    startTime,
    endTime,
    pushTime,
    baseDate,
    tz,
    configs,
    label: '工单推送立即推送',
  })
  if ('error' in result) {
    res.status(502).json({ ok: false, error: result.error })
    return
  }
  res.json({ ok: true, data: result })
})
