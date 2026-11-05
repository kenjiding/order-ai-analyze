import { Router, type Response } from 'express'
import { and, desc, eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { RegionClearancePushSchedule } from '../db/schema'
import { readImileTokenFromRequest } from './imileAuth'
import { normalizeImileToken } from '../imile/shared'
import { fetchImileRegions } from '../imile/regionClearancePush'
import { resolveRegionTz } from '../imile/ausTimezone'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { getGlobalImileToken } from '../feishu/globalImileToken'
import { executeRegionClearancePush, readRegionClearancePushImileToken } from '../feishu/regionClearancePushScheduledPush'
import { parseSupplierMentionContacts } from '../feishu/feishuMentionHelpers'
import { parseStationEntries, type RegionStationEntry } from '../regionClearancePush/types'

export const regionClearancePushRouter = Router()

type ScheduleBody = {
  regionCode?: unknown
  regionName?: unknown
  stationCodes?: unknown
  weekdays?: unknown
  pushTimes?: unknown
  isEnabled?: unknown
  chatId?: unknown
  mentionOpenIds?: unknown
  imileToken?: unknown
}

type PublicSchedule = {
  id: string
  regionCode: string
  regionName: string
  stationCodes: RegionStationEntry[]
  weekdays: RegionClearancePushSchedule['weekdays']
  pushTimes: RegionClearancePushSchedule['pushTimes']
  isEnabled: boolean
  chatId: string
  mentionOpenIds: ReturnType<typeof parseSupplierMentionContacts>
  regionAccountCode: string | null
  updatedAt: Date
  hasImileToken: boolean
}

function normalizeStationEntries(raw: unknown): RegionStationEntry[] {
  return parseStationEntries(raw)
}

async function toPublicSchedule(
  row: RegionClearancePushSchedule,
  regionAccountCode: string | null,
): Promise<PublicSchedule> {
  return {
    id: row.id,
    regionCode: row.regionCode,
    regionName: row.regionName,
    stationCodes: parseStationEntries(row.stationCodes),
    weekdays: row.weekdays,
    pushTimes: row.pushTimes,
    isEnabled: row.isEnabled,
    chatId: row.chatId,
    mentionOpenIds: parseSupplierMentionContacts(row.mentionOpenIds),
    regionAccountCode,
    updatedAt: row.updatedAt,
    hasImileToken: Boolean(await readRegionClearancePushImileToken(row)),
  }
}

async function loadOwnScheduleRow(
  db: ReturnType<typeof getDb>,
  userId: string,
  id: string,
): Promise<RegionClearancePushSchedule | null> {
  const rows = await db
    .select()
    .from(schema.regionClearancePushSchedules)
    .where(and(eq(schema.regionClearancePushSchedules.id, id), eq(schema.regionClearancePushSchedules.userId, userId)))
    .limit(1)
  return rows[0] ?? null
}

function extractScheduleFields(body: ScheduleBody) {
  return {
    regionCode: typeof body.regionCode === 'string' ? body.regionCode.trim() : '',
    regionName: typeof body.regionName === 'string' ? body.regionName.trim() : '',
    stationCodes: normalizeStationEntries(body.stationCodes),
    weekdays: Array.isArray(body.weekdays) ? body.weekdays : [],
    pushTimes: Array.isArray(body.pushTimes) ? body.pushTimes : [],
    isEnabled: body.isEnabled !== false,
    chatId: typeof body.chatId === 'string' ? body.chatId.trim() : '',
    mentionOpenIds: parseSupplierMentionContacts(body.mentionOpenIds),
  }
}

// ─── 大区列表（代理 permission/station，ocType=AC,RG） ─────────────────────────

regionClearancePushRouter.get('/regions', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  const token = (await getGlobalImileToken(userId)) || readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token，请在全局设置中配置' })
    return
  }
  const result = await fetchImileRegions(token)
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

// ─── 定时推送配置（按账号隔离，一个账号可有多条，按大区区分） ────────────────────

regionClearancePushRouter.get('/schedules', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.regionClearancePushSchedules)
      .where(eq(schema.regionClearancePushSchedules.userId, userId))
      .orderBy(desc(schema.regionClearancePushSchedules.createdAt))
    const data = await Promise.all(rows.map((row) => toPublicSchedule(row, req.authUser?.regionCode ?? null)))
    res.json({ ok: true, data })
  } catch {
    res.status(500).json({ ok: false, error: '读取区域清货数据推送配置失败' })
  }
})

regionClearancePushRouter.post('/schedules', async (req: AuthenticatedRequest, res: Response) => {
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
  if (!fields.regionCode || !fields.regionName) {
    res.status(400).json({ ok: false, error: '缺少必填字段: regionCode, regionName' })
    return
  }
  if (!fields.chatId) {
    res.status(400).json({ ok: false, error: '缺少必填字段: chatId' })
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
    const db = getDb()
    const [created] = await db
      .insert(schema.regionClearancePushSchedules)
      .values({
        userId,
        regionCode: fields.regionCode,
        regionName: fields.regionName,
        stationCodes: fields.stationCodes,
        weekdays: fields.weekdays,
        pushTimes: fields.pushTimes,
        isEnabled: fields.isEnabled,
        chatId: fields.chatId,
        mentionOpenIds: fields.mentionOpenIds,
        imileToken: nextImileToken ? normalizeImileToken(nextImileToken) : null,
        updatedBy: userId,
      })
      .returning()
    res.json({ ok: true, data: await toPublicSchedule(created, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '新增区域清货数据推送配置失败' })
  }
})

regionClearancePushRouter.put('/schedules/:id', async (req: AuthenticatedRequest, res: Response) => {
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
  if (!fields.regionCode || !fields.regionName) {
    res.status(400).json({ ok: false, error: '缺少必填字段: regionCode, regionName' })
    return
  }
  if (!fields.chatId) {
    res.status(400).json({ ok: false, error: '缺少必填字段: chatId' })
    return
  }

  try {
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
      .update(schema.regionClearancePushSchedules)
      .set({
        regionCode: fields.regionCode,
        regionName: fields.regionName,
        stationCodes: fields.stationCodes,
        weekdays: fields.weekdays,
        pushTimes: fields.pushTimes,
        isEnabled: fields.isEnabled,
        chatId: fields.chatId,
        mentionOpenIds: fields.mentionOpenIds,
        ...(nextImileToken ? { imileToken: normalizeImileToken(nextImileToken) } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.regionClearancePushSchedules.id, existing.id))
      .returning()
    res.json({ ok: true, data: await toPublicSchedule(updated, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '保存区域清货数据推送配置失败' })
  }
})

regionClearancePushRouter.delete('/schedules/:id', async (req: AuthenticatedRequest, res: Response) => {
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
    await db.delete(schema.regionClearancePushSchedules).where(eq(schema.regionClearancePushSchedules.id, existing.id))
    res.json({ ok: true, data: null })
  } catch {
    res.status(500).json({ ok: false, error: '删除区域清货数据推送配置失败' })
  }
})

/** 立即推送：按该条目已保存的大区/站点/群执行，不校验 weekdays / pushTimes */
regionClearancePushRouter.post('/schedules/:id/push-now', async (req: AuthenticatedRequest, res: Response) => {
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
    if (!schedule.regionCode?.trim() || !schedule.chatId?.trim()) {
      res.status(400).json({ ok: false, error: '该配置未设置大区或推送群' })
      return
    }

    const token = await readRegionClearancePushImileToken(schedule)
    if (!token) {
      res.status(400).json({ ok: false, error: '缺少 iMile token，请编辑该配置并重新保存' })
      return
    }

    const tz = resolveRegionTz(req.authUser?.regionCode)
    const { dateStr: todayDateStr, prevDateStr: yesterdayDateStr, timeHHmm } = getRegionNow(tz)

    const result = await executeRegionClearancePush({
      token,
      schedule,
      todayDateStr,
      yesterdayDateStr,
      pushTime: timeHHmm,
      label: `[region-clearance-push/push-now schedule=${schedule.id}]`,
      // 立即推送只读快照做对比展示，不覆盖，避免手动测试把「推送间趋势」基准带偏
      updateSnapshot: false,
    })
    if (!result.ok) {
      res.status(502).json({ ok: false, error: result.error })
      return
    }
    res.json({ ok: true, data: null })
  } catch {
    res.status(500).json({ ok: false, error: '立即推送失败' })
  }
})
