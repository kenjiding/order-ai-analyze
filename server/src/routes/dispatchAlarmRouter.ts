import { Router, type Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { DispatchAlarmSchedule } from '../db/schema'
import { readImileTokenFromRequest } from './imileAuth'
import { normalizeImileToken } from '../imile/shared'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz } from '../imile/ausTimezone'
import { listPushableSupplierPushConfigsByIds, parsePushConfigIds } from '../supplierPushConfigs'
import { dispatchAlarmScheduledScope } from '../supplierConfigScopes/dispatchAlarmScheduled'
import { executeDispatchAlarmPush, hasDispatchAlarmImileToken } from '../feishu/dispatchAlarmScheduledPush'

export const dispatchAlarmRouter = Router()

const DEFAULT_ALERT_THRESHOLD_PCT = 92
const MIN_ALERT_THRESHOLD_PCT = 0
const MAX_ALERT_THRESHOLD_PCT = 100

// ─── 定时推送配置（按账号隔离，每个账号最多一条） ────────────────────────────────

type ScheduleBody = {
  weekdays?: unknown
  pushTimes?: unknown
  isEnabled?: unknown
  stationCode?: unknown
  alertThresholdPct?: unknown
  imileToken?: unknown
}

type PublicDispatchAlarmSchedule = {
  id: string
  weekdays: DispatchAlarmSchedule['weekdays']
  pushTimes: DispatchAlarmSchedule['pushTimes']
  isEnabled: boolean
  stationCode: string
  alertThresholdPct: number
  /** 拥有该配置的账号所属州/区域，决定 pushTimes/weekdays 按哪个时区判断；只读，随账号信息变化 */
  regionCode: string | null
  pushConfigIds: string[]
  updatedAt: Date
  hasImileToken: boolean
}

function normalizeAlertThresholdPct(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_ALERT_THRESHOLD_PCT
  return Math.min(MAX_ALERT_THRESHOLD_PCT, Math.max(MIN_ALERT_THRESHOLD_PCT, Math.round(n)))
}

async function toPublicSchedule(
  row: DispatchAlarmSchedule,
  regionCode: string | null,
): Promise<PublicDispatchAlarmSchedule> {
  const pushConfigIds = await dispatchAlarmScheduledScope.loadEnabledConfigIds()
  return {
    id: row.id,
    weekdays: row.weekdays,
    pushTimes: row.pushTimes,
    isEnabled: row.isEnabled,
    stationCode: row.stationCode,
    alertThresholdPct: row.alertThresholdPct,
    regionCode,
    pushConfigIds,
    updatedAt: row.updatedAt,
    hasImileToken: hasDispatchAlarmImileToken(row),
  }
}

async function loadOwnScheduleRow(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<DispatchAlarmSchedule | null> {
  const rows = await db
    .select()
    .from(schema.dispatchAlarmSchedules)
    .where(eq(schema.dispatchAlarmSchedules.userId, userId))
    .limit(1)
  return rows[0] ?? null
}

dispatchAlarmRouter.get('/schedule', async (req: AuthenticatedRequest, res: Response) => {
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

dispatchAlarmRouter.put('/schedule', async (req: AuthenticatedRequest, res: Response) => {
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
  try {
    const db = getDb()
    const existing = await loadOwnScheduleRow(db, userId)

    const stationCode = typeof body.stationCode === 'string' ? body.stationCode.trim() : ''
    const alertThresholdPct = normalizeAlertThresholdPct(body.alertThresholdPct)
    const tokenFromBody = typeof body.imileToken === 'string' ? body.imileToken.trim() : ''
    const tokenFromHeader = readImileTokenFromRequest(req, body.imileToken)
    const nextImileToken = tokenFromBody || tokenFromHeader

    const isEnabled = body.isEnabled !== false
    const willEnable = isEnabled && body.pushTimes.length > 0 && body.weekdays.length > 0
    const existingToken = existing?.imileToken?.trim() ?? ''
    if (willEnable && !nextImileToken && !existingToken && !hasDispatchAlarmImileToken(existing)) {
      res.status(400).json({
        ok: false,
        error: '启用定时推送需要 iMile token，请在全局设置中配置后重新保存',
      })
      return
    }

    let row: DispatchAlarmSchedule
    if (existing) {
      const [updated] = await db
        .update(schema.dispatchAlarmSchedules)
        .set({
          weekdays: body.weekdays,
          pushTimes: body.pushTimes,
          isEnabled,
          stationCode,
          alertThresholdPct,
          ...(nextImileToken ? { imileToken: normalizeImileToken(nextImileToken) } : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.dispatchAlarmSchedules.id, existing.id))
        .returning()
      row = updated
    } else {
      const [created] = await db
        .insert(schema.dispatchAlarmSchedules)
        .values({
          userId,
          weekdays: body.weekdays,
          pushTimes: body.pushTimes,
          isEnabled,
          stationCode,
          alertThresholdPct,
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

dispatchAlarmRouter.put('/schedule/push-config-ids', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  const body = req.body as { pushConfigIds?: unknown }
  const pushConfigIds = parsePushConfigIds(body.pushConfigIds)
  try {
    await dispatchAlarmScheduledScope.saveEnabledConfigIds(pushConfigIds)
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

// ─── 立即推送 24H 派签告警 ─────────────────────────────────────────────────────

dispatchAlarmRouter.post('/push-now', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  type PushNowBody = { stationCode?: unknown; date?: unknown; configIds?: unknown; alertThresholdPct?: unknown }
  const body = req.body as PushNowBody

  if (typeof body.stationCode !== 'string' || !body.stationCode.trim()) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode' })
    return
  }
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date.trim())) {
    res.status(400).json({ ok: false, error: 'date 格式应为 YYYY-MM-DD' })
    return
  }

  const configIds = Array.isArray(body.configIds)
    ? body.configIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim())
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

  const stationCode = body.stationCode.trim()
  const date = body.date.trim()
  const alertThresholdPct = normalizeAlertThresholdPct(body.alertThresholdPct)
  const tz = resolveRegionTz(req.authUser?.regionCode)
  const { timeHHmm: pushTime } = getRegionNow(tz)

  const result = await executeDispatchAlarmPush({
    token,
    stationCode,
    date,
    pushTime,
    alertThresholdPct,
    configs,
    tz,
    label: '24H派签告警立即推送',
  })
  if ('error' in result) {
    res.status(502).json({ ok: false, error: result.error })
    return
  }
  res.json({ ok: true, data: result })
})
