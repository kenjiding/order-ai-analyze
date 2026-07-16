import { Router, type Response } from 'express'
import { and, desc, eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { ChaseDispatchSchedule } from '../db/schema'
import { readImileTokenFromRequest } from './imileAuth'
import { normalizeImileToken } from '../imile/shared'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz } from '../imile/ausTimezone'
import { listPushableSupplierPushConfigsForSchedule, parsePushConfigIds, validatePushConfigIdsForSchedule } from '../supplierPushConfigs'
import {
  executeChaseDispatchPush,
  hasChaseDispatchImileToken,
  parseStagnationBuckets,
  readChaseDispatchImileToken,
} from '../feishu/chaseDispatchScheduledPush'
import { isStagnationBucket, type StagnationBucket } from '../imile/stagnantWaybills'

export const chaseDispatchRouter = Router()

// ─── 定时推送配置（按账号隔离，一个账号可有多条，按站点区分） ────────────────────

type ScheduleBody = {
  weekdays?: unknown
  pushTimes?: unknown
  stagnationBuckets?: unknown
  isEnabled?: unknown
  stationCode?: unknown
  pushConfigIds?: unknown
  imileToken?: unknown
}

type PublicChaseDispatchSchedule = {
  id: string
  weekdays: ChaseDispatchSchedule['weekdays']
  pushTimes: ChaseDispatchSchedule['pushTimes']
  stagnationBuckets: StagnationBucket[]
  isEnabled: boolean
  stationCode: string
  pushConfigIds: string[]
  regionCode: string | null
  updatedAt: Date
  hasImileToken: boolean
}

function toPublicSchedule(row: ChaseDispatchSchedule, regionCode: string | null): PublicChaseDispatchSchedule {
  return {
    id: row.id,
    weekdays: row.weekdays,
    pushTimes: row.pushTimes,
    stagnationBuckets: parseStagnationBuckets(row.stagnationBuckets),
    isEnabled: row.isEnabled,
    stationCode: row.stationCode,
    pushConfigIds: parsePushConfigIds(row.pushConfigIds),
    regionCode,
    updatedAt: row.updatedAt,
    hasImileToken: hasChaseDispatchImileToken(row),
  }
}

async function loadOwnScheduleRow(
  db: ReturnType<typeof getDb>,
  userId: string,
  id: string,
): Promise<ChaseDispatchSchedule | null> {
  const rows = await db
    .select()
    .from(schema.chaseDispatchSchedules)
    .where(and(eq(schema.chaseDispatchSchedules.id, id), eq(schema.chaseDispatchSchedules.userId, userId)))
    .limit(1)
  return rows[0] ?? null
}

function extractScheduleFields(body: ScheduleBody) {
  const stagnationBuckets = Array.isArray(body.stagnationBuckets)
    ? body.stagnationBuckets.filter(isStagnationBucket)
    : []
  return {
    weekdays: Array.isArray(body.weekdays) ? body.weekdays : [],
    pushTimes: Array.isArray(body.pushTimes) ? body.pushTimes : [],
    stagnationBuckets,
    isEnabled: body.isEnabled !== false,
    stationCode: typeof body.stationCode === 'string' ? body.stationCode.trim() : '',
    pushConfigIds: parsePushConfigIds(body.pushConfigIds),
  }
}

chaseDispatchRouter.get('/schedules', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.chaseDispatchSchedules)
      .where(eq(schema.chaseDispatchSchedules.userId, userId))
      .orderBy(desc(schema.chaseDispatchSchedules.createdAt))
    res.json({ ok: true, data: rows.map((row) => toPublicSchedule(row, req.authUser?.regionCode ?? null)) })
  } catch {
    res.status(500).json({ ok: false, error: '读取催派推送配置失败' })
  }
})

chaseDispatchRouter.post('/schedules', async (req: AuthenticatedRequest, res: Response) => {
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

  const willEnable =
    fields.isEnabled && fields.pushTimes.length > 0 && fields.weekdays.length > 0 && fields.stagnationBuckets.length > 0
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
      .insert(schema.chaseDispatchSchedules)
      .values({
        userId,
        weekdays: fields.weekdays,
        pushTimes: fields.pushTimes,
        stagnationBuckets: fields.stagnationBuckets,
        isEnabled: fields.isEnabled,
        stationCode: fields.stationCode,
        pushConfigIds: fields.pushConfigIds,
        imileToken: nextImileToken ? normalizeImileToken(nextImileToken) : null,
        updatedBy: userId,
      })
      .returning()
    res.json({ ok: true, data: toPublicSchedule(created, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '新增催派推送配置失败' })
  }
})

chaseDispatchRouter.put('/schedules/:id', async (req: AuthenticatedRequest, res: Response) => {
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

    const willEnable =
      fields.isEnabled && fields.pushTimes.length > 0 && fields.weekdays.length > 0 && fields.stagnationBuckets.length > 0
    const existingToken = existing.imileToken?.trim() ?? ''
    if (willEnable && !nextImileToken && !existingToken) {
      res.status(400).json({ ok: false, error: '启用定时推送需要 iMile token，请在全局设置中配置后重新保存' })
      return
    }

    const [updated] = await db
      .update(schema.chaseDispatchSchedules)
      .set({
        weekdays: fields.weekdays,
        pushTimes: fields.pushTimes,
        stagnationBuckets: fields.stagnationBuckets,
        isEnabled: fields.isEnabled,
        stationCode: fields.stationCode,
        pushConfigIds: fields.pushConfigIds,
        ...(nextImileToken ? { imileToken: normalizeImileToken(nextImileToken) } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.chaseDispatchSchedules.id, existing.id))
      .returning()
    res.json({ ok: true, data: toPublicSchedule(updated, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '保存催派推送配置失败' })
  }
})

chaseDispatchRouter.delete('/schedules/:id', async (req: AuthenticatedRequest, res: Response) => {
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
    await db.delete(schema.chaseDispatchSchedules).where(eq(schema.chaseDispatchSchedules.id, existing.id))
    res.json({ ok: true, data: null })
  } catch {
    res.status(500).json({ ok: false, error: '删除催派推送配置失败' })
  }
})

/** 立刻推送：按该条目已保存的站点/供应商/滞留区间执行，不校验 weekdays / pushTimes */
chaseDispatchRouter.post('/schedules/:id/push-now', async (req: AuthenticatedRequest, res: Response) => {
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

    const buckets = parseStagnationBuckets(schedule.stagnationBuckets)
    if (buckets.length === 0) {
      res.status(400).json({ ok: false, error: '该配置未选择滞留时间' })
      return
    }

    const token = readChaseDispatchImileToken(schedule)
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
    const { dateStr: baseDate, timeHHmm: pushTime } = getRegionNow(tz)

    const result = await executeChaseDispatchPush({
      token,
      stationCode,
      baseDate,
      pushTime,
      buckets,
      configs,
      label: `[chase-dispatch/push-now schedule=${schedule.id}]`,
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
