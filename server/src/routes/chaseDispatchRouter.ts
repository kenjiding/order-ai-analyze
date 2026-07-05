import { Router, type Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { ChaseDispatchSchedule } from '../db/schema'
import { readImileTokenFromRequest } from './imileAuth'
import { normalizeImileToken } from '../imile/shared'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz } from '../imile/ausTimezone'
import { listPushableSupplierPushConfigsByIds, parsePushConfigIds } from '../supplierPushConfigs'
import { chaseDispatchScheduledScope } from '../supplierConfigScopes/chaseDispatchScheduled'
import {
  executeChaseDispatchPush,
  hasChaseDispatchImileToken,
  parseStagnationBuckets,
} from '../feishu/chaseDispatchScheduledPush'
import { isStagnationBucket, type StagnationBucket } from '../imile/stagnantWaybills'

export const chaseDispatchRouter = Router()

// ─── 定时推送配置（按账号隔离，每个账号最多一条） ────────────────────────────────

type ScheduleBody = {
  weekdays?: unknown
  pushTimes?: unknown
  stagnationBuckets?: unknown
  isEnabled?: unknown
  stationCode?: unknown
  imileToken?: unknown
}

type PublicChaseDispatchSchedule = {
  id: string
  weekdays: ChaseDispatchSchedule['weekdays']
  pushTimes: ChaseDispatchSchedule['pushTimes']
  stagnationBuckets: StagnationBucket[]
  isEnabled: boolean
  stationCode: string
  regionCode: string | null
  pushConfigIds: string[]
  updatedAt: Date
  hasImileToken: boolean
}

async function toPublicSchedule(
  row: ChaseDispatchSchedule,
  regionCode: string | null,
): Promise<PublicChaseDispatchSchedule> {
  const pushConfigIds = await chaseDispatchScheduledScope.loadEnabledConfigIds()
  return {
    id: row.id,
    weekdays: row.weekdays,
    pushTimes: row.pushTimes,
    stagnationBuckets: parseStagnationBuckets(row.stagnationBuckets),
    isEnabled: row.isEnabled,
    stationCode: row.stationCode,
    regionCode,
    pushConfigIds,
    updatedAt: row.updatedAt,
    hasImileToken: hasChaseDispatchImileToken(row),
  }
}

async function loadOwnScheduleRow(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<ChaseDispatchSchedule | null> {
  const rows = await db
    .select()
    .from(schema.chaseDispatchSchedules)
    .where(eq(schema.chaseDispatchSchedules.userId, userId))
    .limit(1)
  return rows[0] ?? null
}

chaseDispatchRouter.get('/schedule', async (req: AuthenticatedRequest, res: Response) => {
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

chaseDispatchRouter.put('/schedule', async (req: AuthenticatedRequest, res: Response) => {
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
  const stagnationBuckets = Array.isArray(body.stagnationBuckets)
    ? body.stagnationBuckets.filter(isStagnationBucket)
    : []
  try {
    const db = getDb()
    const existing = await loadOwnScheduleRow(db, userId)

    const stationCode = typeof body.stationCode === 'string' ? body.stationCode.trim() : ''
    const tokenFromBody = typeof body.imileToken === 'string' ? body.imileToken.trim() : ''
    const tokenFromHeader = readImileTokenFromRequest(req, body.imileToken)
    const nextImileToken = tokenFromBody || tokenFromHeader

    const isEnabled = body.isEnabled !== false
    const willEnable =
      isEnabled && body.pushTimes.length > 0 && body.weekdays.length > 0 && stagnationBuckets.length > 0
    const existingToken = existing?.imileToken?.trim() ?? ''
    if (willEnable && !nextImileToken && !existingToken && !hasChaseDispatchImileToken(existing)) {
      res.status(400).json({
        ok: false,
        error: '启用定时推送需要 iMile token，请在全局设置中配置后重新保存',
      })
      return
    }

    let row: ChaseDispatchSchedule
    if (existing) {
      const [updated] = await db
        .update(schema.chaseDispatchSchedules)
        .set({
          weekdays: body.weekdays,
          pushTimes: body.pushTimes,
          stagnationBuckets,
          isEnabled,
          stationCode,
          ...(nextImileToken ? { imileToken: normalizeImileToken(nextImileToken) } : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.chaseDispatchSchedules.id, existing.id))
        .returning()
      row = updated
    } else {
      const [created] = await db
        .insert(schema.chaseDispatchSchedules)
        .values({
          userId,
          weekdays: body.weekdays,
          pushTimes: body.pushTimes,
          stagnationBuckets,
          isEnabled,
          stationCode,
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

chaseDispatchRouter.put('/schedule/push-config-ids', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  const body = req.body as { pushConfigIds?: unknown }
  const pushConfigIds = parsePushConfigIds(body.pushConfigIds)
  try {
    await chaseDispatchScheduledScope.saveEnabledConfigIds(pushConfigIds)
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

// ─── 立即推送催派 ─────────────────────────────────────────────────────────────

chaseDispatchRouter.post('/push-now', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  type PushNowBody = {
    stationCode?: unknown
    baseDate?: unknown
    pushTime?: unknown
    stagnationBuckets?: unknown
    configIds?: unknown
  }
  const body = req.body as PushNowBody

  if (typeof body.stationCode !== 'string' || !body.stationCode.trim()) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode' })
    return
  }

  const buckets = Array.isArray(body.stagnationBuckets)
    ? body.stagnationBuckets.filter(isStagnationBucket)
    : []
  if (buckets.length === 0) {
    res.status(400).json({ ok: false, error: '请至少选择一个滞留时间' })
    return
  }

  const configIds = Array.isArray(body.configIds)
    ? body.configIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    : []
  if (configIds.length === 0) {
    res.status(400).json({ ok: false, error: '请至少选择一个供应商配置' })
    return
  }

  const stationCode = body.stationCode.trim()
  const pushTime = typeof body.pushTime === 'string' && body.pushTime.trim() ? body.pushTime.trim() : '00:00'
  const tz = resolveRegionTz(req.authUser?.regionCode)
  const baseDate =
    typeof body.baseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.baseDate.trim())
      ? body.baseDate.trim()
      : getRegionNow(tz).dateStr

  const configs = await listPushableSupplierPushConfigsByIds(configIds)
  if (configs.length === 0) {
    res.status(400).json({ ok: false, error: '所选供应商均不可用（未配置 Webhook）' })
    return
  }

  const result = await executeChaseDispatchPush({
    token,
    stationCode,
    baseDate,
    pushTime,
    buckets,
    configs,
    label: '催派立即推送',
  })
  if ('error' in result) {
    res.status(502).json({ ok: false, error: result.error })
    return
  }
  res.json({ ok: true, data: result })
})
