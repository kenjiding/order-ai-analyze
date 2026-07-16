import { Router, type Response } from 'express'
import { and, desc, eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { DispatchAlarmSchedule } from '../db/schema'
import { readImileTokenFromRequest } from './imileAuth'
import { normalizeImileToken } from '../imile/shared'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz } from '../imile/ausTimezone'
import { lastSortingWorkdayOnOrBefore } from '../imile/sortingWorkday'
import { listPushableSupplierPushConfigsForSchedule, parsePushConfigIds, validatePushConfigIdsForSchedule } from '../supplierPushConfigs'
import {
  executeDispatchAlarmPush,
  hasDispatchAlarmImileToken,
  readDispatchAlarmImileToken,
} from '../feishu/dispatchAlarmScheduledPush'

export const dispatchAlarmRouter = Router()

const DEFAULT_ALERT_THRESHOLD_PCT = 92
const MIN_ALERT_THRESHOLD_PCT = 0
const MAX_ALERT_THRESHOLD_PCT = 100

// ─── 定时推送配置（按账号隔离，一个账号可有多条，按站点区分） ────────────────────

type ScheduleBody = {
  weekdays?: unknown
  pushTimes?: unknown
  isEnabled?: unknown
  stationCode?: unknown
  alertThresholdPct?: unknown
  pushConfigIds?: unknown
  imileToken?: unknown
}

type PublicDispatchAlarmSchedule = {
  id: string
  weekdays: DispatchAlarmSchedule['weekdays']
  pushTimes: DispatchAlarmSchedule['pushTimes']
  isEnabled: boolean
  stationCode: string
  alertThresholdPct: number
  pushConfigIds: string[]
  /** 拥有该配置的账号所属州/区域，决定 pushTimes/weekdays 按哪个时区判断；只读，随账号信息变化 */
  regionCode: string | null
  updatedAt: Date
  hasImileToken: boolean
}

function normalizeAlertThresholdPct(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_ALERT_THRESHOLD_PCT
  return Math.min(MAX_ALERT_THRESHOLD_PCT, Math.max(MIN_ALERT_THRESHOLD_PCT, Math.round(n)))
}

function toPublicSchedule(row: DispatchAlarmSchedule, regionCode: string | null): PublicDispatchAlarmSchedule {
  return {
    id: row.id,
    weekdays: row.weekdays,
    pushTimes: row.pushTimes,
    isEnabled: row.isEnabled,
    stationCode: row.stationCode,
    alertThresholdPct: row.alertThresholdPct,
    pushConfigIds: parsePushConfigIds(row.pushConfigIds),
    regionCode,
    updatedAt: row.updatedAt,
    hasImileToken: hasDispatchAlarmImileToken(row),
  }
}

async function loadOwnScheduleRow(
  db: ReturnType<typeof getDb>,
  userId: string,
  id: string,
): Promise<DispatchAlarmSchedule | null> {
  const rows = await db
    .select()
    .from(schema.dispatchAlarmSchedules)
    .where(and(eq(schema.dispatchAlarmSchedules.id, id), eq(schema.dispatchAlarmSchedules.userId, userId)))
    .limit(1)
  return rows[0] ?? null
}

function extractScheduleFields(body: ScheduleBody) {
  return {
    weekdays: Array.isArray(body.weekdays) ? body.weekdays : [],
    pushTimes: Array.isArray(body.pushTimes) ? body.pushTimes : [],
    isEnabled: body.isEnabled !== false,
    stationCode: typeof body.stationCode === 'string' ? body.stationCode.trim() : '',
    alertThresholdPct: normalizeAlertThresholdPct(body.alertThresholdPct),
    pushConfigIds: parsePushConfigIds(body.pushConfigIds),
  }
}

dispatchAlarmRouter.get('/schedules', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.dispatchAlarmSchedules)
      .where(eq(schema.dispatchAlarmSchedules.userId, userId))
      .orderBy(desc(schema.dispatchAlarmSchedules.createdAt))
    res.json({ ok: true, data: rows.map((row) => toPublicSchedule(row, req.authUser?.regionCode ?? null)) })
  } catch {
    res.status(500).json({ ok: false, error: '读取派签告警配置失败' })
  }
})

dispatchAlarmRouter.post('/schedules', async (req: AuthenticatedRequest, res: Response) => {
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
      const pushConfigError = await validatePushConfigIdsForSchedule(fields.pushConfigIds, {
        regionCode: req.authUser?.regionCode,
        stationCode: fields.stationCode,
      })
      if (pushConfigError) {
        res.status(400).json({ ok: false, error: pushConfigError })
        return
      }
    }

    const db = getDb()
    const [created] = await db
      .insert(schema.dispatchAlarmSchedules)
      .values({
        userId,
        weekdays: fields.weekdays,
        pushTimes: fields.pushTimes,
        isEnabled: fields.isEnabled,
        stationCode: fields.stationCode,
        alertThresholdPct: fields.alertThresholdPct,
        pushConfigIds: fields.pushConfigIds,
        imileToken: nextImileToken ? normalizeImileToken(nextImileToken) : null,
        updatedBy: userId,
      })
      .returning()
    res.json({ ok: true, data: toPublicSchedule(created, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '新增派签告警配置失败' })
  }
})

dispatchAlarmRouter.put('/schedules/:id', async (req: AuthenticatedRequest, res: Response) => {
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
      const pushConfigError = await validatePushConfigIdsForSchedule(fields.pushConfigIds, {
        regionCode: req.authUser?.regionCode,
        stationCode: fields.stationCode,
      })
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
      .update(schema.dispatchAlarmSchedules)
      .set({
        weekdays: fields.weekdays,
        pushTimes: fields.pushTimes,
        isEnabled: fields.isEnabled,
        stationCode: fields.stationCode,
        alertThresholdPct: fields.alertThresholdPct,
        pushConfigIds: fields.pushConfigIds,
        ...(nextImileToken ? { imileToken: normalizeImileToken(nextImileToken) } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.dispatchAlarmSchedules.id, existing.id))
      .returning()
    res.json({ ok: true, data: toPublicSchedule(updated, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '保存派签告警配置失败' })
  }
})

dispatchAlarmRouter.delete('/schedules/:id', async (req: AuthenticatedRequest, res: Response) => {
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
    await db.delete(schema.dispatchAlarmSchedules).where(eq(schema.dispatchAlarmSchedules.id, existing.id))
    res.json({ ok: true, data: null })
  } catch {
    res.status(500).json({ ok: false, error: '删除派签告警配置失败' })
  }
})

/** 立刻推送：按该条目已保存的站点/供应商/阈值执行，不校验 weekdays / pushTimes */
dispatchAlarmRouter.post('/schedules/:id/push-now', async (req: AuthenticatedRequest, res: Response) => {
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

    const token = readDispatchAlarmImileToken(schedule)
    if (!token) {
      res.status(400).json({ ok: false, error: '缺少 iMile token，请编辑该配置并重新保存' })
      return
    }

    const configs = await listPushableSupplierPushConfigsForSchedule(parsePushConfigIds(schedule.pushConfigIds), {
      regionCode: req.authUser?.regionCode,
      stationCode,
    })
    if (configs.length === 0) {
      const detail = await validatePushConfigIdsForSchedule(parsePushConfigIds(schedule.pushConfigIds), {
        regionCode: req.authUser?.regionCode,
        stationCode,
      })
      res.status(400).json({
        ok: false,
        error: detail ?? '请至少选择一个已配置 Webhook 的供应商',
      })
      return
    }

    const tz = resolveRegionTz(req.authUser?.regionCode)
    const { prevDateStr, timeHHmm: pushTime } = getRegionNow(tz)
    const date = lastSortingWorkdayOnOrBefore(prevDateStr)

    const result = await executeDispatchAlarmPush({
      token,
      stationCode,
      date,
      pushTime,
      alertThresholdPct: schedule.alertThresholdPct,
      configs,
      tz,
      label: `[dispatch-alarm/push-now schedule=${schedule.id}]`,
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
