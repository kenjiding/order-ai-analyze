import { Router, type Response } from 'express'
import { and, desc, eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { ExitAlarmSchedule } from '../db/schema'
import { readImileTokenFromRequest } from './imileAuth'
import { normalizeImileToken } from '../imile/shared'
import { fetchWaybillDetailsByInboundIndex, getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz } from '../imile/ausTimezone'
import { lastSortingWorkdayOnOrBefore } from '../imile/sortingWorkday'
import {
  executeExitAlarmPush,
  hasExitAlarmImileToken,
  readExitAlarmImileToken,
} from '../feishu/exitAlarmScheduledPush'
import { listPushableSupplierPushConfigsForSchedule, parsePushConfigIds, validatePushConfigIdsForSchedule } from '../supplierPushConfigs'

export const exitAlarmRouter = Router()

// ─── 定时推送配置（按账号隔离，一个账号可有多条，按站点区分） ────────────────────

type ScheduleBody = {
  weekdays?: unknown
  pushTimes?: unknown
  isEnabled?: unknown
  stationCode?: unknown
  pushConfigIds?: unknown
  mentionEnabled?: unknown
  routeCodeWhitelistPushEnabled?: unknown
  arrivalScanDates?: unknown
  clearancePrice?: unknown
  importantNotice?: unknown
  imileToken?: unknown
}

type PublicExitAlarmSchedule = {
  id: string
  weekdays: ExitAlarmSchedule['weekdays']
  pushTimes: ExitAlarmSchedule['pushTimes']
  isEnabled: boolean
  stationCode: string
  pushConfigIds: string[]
  mentionEnabled: boolean
  routeCodeWhitelistPushEnabled: boolean
  /** 「立刻推送」使用的到件扫描日期 YYYY-MM-DD，可多选；为空时按自动计算的最近工作日兜底 */
  arrivalScanDates: string[]
  /** 滞留清货价：每件清货补贴（美元），为空表示不推送清货费用 */
  clearancePrice: number | null
  /** 重要提醒：填了就原样追加在推送卡片末尾，为空表示不追加 */
  importantNotice: string | null
  /** 拥有该配置的账号所属州/区域，决定 pushTimes/weekdays 按哪个时区判断；只读，随账号信息变化 */
  regionCode: string | null
  updatedAt: Date
  hasImileToken: boolean
}

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/
/** 「立刻推送」到件扫描日期的多选上限：每多一天就多一轮 iMile 拉数，避免一次点击拖垮接口 */
const MAX_ARRIVAL_SCAN_DATES = 7

/** 滞留清货价：非法/空值一律当作未配置（null），不做静默兜底为 0 */
function normalizeClearancePrice(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 到件扫描日期：去重排序后返回，非法值直接丢弃；最多 MAX_ARRIVAL_SCAN_DATES 天（每天一次 iMile 拉数） */
function normalizeArrivalScanDates(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const valid = list.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => DATE_STR_RE.test(v))
  return [...new Set(valid)].sort()
}

/** 滞留数据看的是「到现在还有多少没出仓」，当天到件也有意义，因此只挡未来日期；同时限制天数上限 */
function validateArrivalScanDates(dates: string[], regionCode: string | null | undefined): string | null {
  if (dates.length > MAX_ARRIVAL_SCAN_DATES) return `到件扫描时间最多选择 ${MAX_ARRIVAL_SCAN_DATES} 天`
  const today = getRegionNow(resolveRegionTz(regionCode)).dateStr
  return dates.some((d) => d > today) ? '到件扫描时间不能选今天之后的日期' : null
}

async function toPublicSchedule(
  row: ExitAlarmSchedule,
  regionCode: string | null,
): Promise<PublicExitAlarmSchedule> {
  return {
    id: row.id,
    weekdays: row.weekdays,
    pushTimes: row.pushTimes,
    isEnabled: row.isEnabled,
    stationCode: row.stationCode,
    pushConfigIds: parsePushConfigIds(row.pushConfigIds),
    mentionEnabled: row.mentionEnabled,
    routeCodeWhitelistPushEnabled: row.routeCodeWhitelistPushEnabled,
    arrivalScanDates: (row.arrivalScanDates as string[] | null) ?? [],
    clearancePrice: row.clearancePrice ?? null,
    importantNotice: row.importantNotice ?? null,
    regionCode,
    updatedAt: row.updatedAt,
    hasImileToken: await hasExitAlarmImileToken(row),
  }
}

async function loadOwnScheduleRow(
  db: ReturnType<typeof getDb>,
  userId: string,
  id: string,
): Promise<ExitAlarmSchedule | null> {
  const rows = await db
    .select()
    .from(schema.exitAlarmSchedules)
    .where(and(eq(schema.exitAlarmSchedules.id, id), eq(schema.exitAlarmSchedules.userId, userId)))
    .limit(1)
  return rows[0] ?? null
}

function extractScheduleFields(body: ScheduleBody) {
  return {
    weekdays: Array.isArray(body.weekdays) ? body.weekdays : [],
    pushTimes: Array.isArray(body.pushTimes) ? body.pushTimes : [],
    isEnabled: body.isEnabled !== false,
    stationCode: typeof body.stationCode === 'string' ? body.stationCode.trim() : '',
    pushConfigIds: parsePushConfigIds(body.pushConfigIds),
    mentionEnabled: body.mentionEnabled === true,
    routeCodeWhitelistPushEnabled: body.routeCodeWhitelistPushEnabled === true,
    arrivalScanDates: normalizeArrivalScanDates(body.arrivalScanDates),
    clearancePrice: normalizeClearancePrice(body.clearancePrice),
    importantNotice: typeof body.importantNotice === 'string' ? body.importantNotice.trim() || null : null,
  }
}

exitAlarmRouter.get('/schedules', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.exitAlarmSchedules)
      .where(eq(schema.exitAlarmSchedules.userId, userId))
      .orderBy(desc(schema.exitAlarmSchedules.createdAt))
    const data = await Promise.all(rows.map((row) => toPublicSchedule(row, req.authUser?.regionCode ?? null)))
    res.json({ ok: true, data })
  } catch {
    res.status(500).json({ ok: false, error: '读取滞留数据告警配置失败' })
  }
})

exitAlarmRouter.post('/schedules', async (req: AuthenticatedRequest, res: Response) => {
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
  const arrivalScanDateError = validateArrivalScanDates(fields.arrivalScanDates, req.authUser?.regionCode)
  if (arrivalScanDateError) {
    res.status(400).json({ ok: false, error: arrivalScanDateError })
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
      .insert(schema.exitAlarmSchedules)
      .values({
        userId,
        weekdays: fields.weekdays,
        pushTimes: fields.pushTimes,
        isEnabled: fields.isEnabled,
        stationCode: fields.stationCode,
        pushConfigIds: fields.pushConfigIds,
        mentionEnabled: fields.mentionEnabled,
        routeCodeWhitelistPushEnabled: fields.routeCodeWhitelistPushEnabled,
        arrivalScanDates: fields.arrivalScanDates,
        clearancePrice: fields.clearancePrice,
        importantNotice: fields.importantNotice,
        imileToken: nextImileToken ? normalizeImileToken(nextImileToken) : null,
        updatedBy: userId,
      })
      .returning()
    res.json({ ok: true, data: await toPublicSchedule(created, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '新增滞留数据告警配置失败' })
  }
})

exitAlarmRouter.put('/schedules/:id', async (req: AuthenticatedRequest, res: Response) => {
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
  const arrivalScanDateError = validateArrivalScanDates(fields.arrivalScanDates, req.authUser?.regionCode)
  if (arrivalScanDateError) {
    res.status(400).json({ ok: false, error: arrivalScanDateError })
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
      .update(schema.exitAlarmSchedules)
      .set({
        weekdays: fields.weekdays,
        pushTimes: fields.pushTimes,
        isEnabled: fields.isEnabled,
        stationCode: fields.stationCode,
        pushConfigIds: fields.pushConfigIds,
        mentionEnabled: fields.mentionEnabled,
        routeCodeWhitelistPushEnabled: fields.routeCodeWhitelistPushEnabled,
        arrivalScanDates: fields.arrivalScanDates,
        clearancePrice: fields.clearancePrice,
        importantNotice: fields.importantNotice,
        ...(nextImileToken ? { imileToken: normalizeImileToken(nextImileToken) } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.exitAlarmSchedules.id, existing.id))
      .returning()
    res.json({ ok: true, data: await toPublicSchedule(updated, req.authUser?.regionCode ?? null) })
  } catch {
    res.status(500).json({ ok: false, error: '保存滞留数据告警配置失败' })
  }
})

exitAlarmRouter.delete('/schedules/:id', async (req: AuthenticatedRequest, res: Response) => {
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
    await db.delete(schema.exitAlarmSchedules).where(eq(schema.exitAlarmSchedules.id, existing.id))
    res.json({ ok: true, data: null })
  } catch {
    res.status(500).json({ ok: false, error: '删除滞留数据告警配置失败' })
  }
})

/** 立刻推送：按该条目已保存的站点/供应商执行，不校验 weekdays / pushTimes */
exitAlarmRouter.post('/schedules/:id/push-now', async (req: AuthenticatedRequest, res: Response) => {
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

    const token = await readExitAlarmImileToken(schedule)
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
    const { dateStr: todayDateStr, prevDateStr, timeHHmm: pushTime } = getRegionNow(tz)
    // 已保存到件扫描日期则按这些日期逐日拉数合并（用户手动指定，不做工作日兜底）；否则沿用自动计算的最近工作日。
    // todayDateStr 仍是今天：阈值锚点=此刻，选历史到件日就是看那批件到现在还滞留多少未出仓。
    const savedDates = (schedule.arrivalScanDates as string[] | null) ?? []
    const dates = savedDates.length > 0 ? savedDates : [lastSortingWorkdayOnOrBefore(prevDateStr)]

    const result = await executeExitAlarmPush({
      token,
      stationCode,
      dates,
      todayDateStr,
      pushTime,
      configs,
      tz,
      label: `[exit-alarm/push-now schedule=${schedule.id}]`,
      mentionEnabled: schedule.mentionEnabled,
      routeCodeWhitelistPushEnabled: schedule.routeCodeWhitelistPushEnabled,
      clearancePrice: schedule.clearancePrice,
      importantNotice: schedule.importantNotice,
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

// ─── 运单查询（代理 iMile DS searchWaybill） ─────────────────────────────────

exitAlarmRouter.post('/search-waybills', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  type SearchBody = { startTime?: unknown; endTime?: unknown; lastScanStationCode?: unknown }
  const body = req.body as SearchBody
  if (
    typeof body.startTime !== 'string' || !body.startTime.trim() ||
    typeof body.endTime !== 'string' || !body.endTime.trim()
  ) {
    res.status(400).json({ ok: false, error: '缺少必填字段: startTime, endTime' })
    return
  }

  const stationCode = typeof body.lastScanStationCode === 'string' ? body.lastScanStationCode.trim() : ''
  if (!stationCode) {
    res.status(400).json({ ok: false, error: '缺少必填字段: lastScanStationCode' })
    return
  }

  const dateStr = body.startTime.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    res.status(400).json({ ok: false, error: 'startTime 日期格式无效' })
    return
  }

  try {
    const result = await fetchWaybillDetailsByInboundIndex({
      token,
      stationCode,
      dateStr,
      tz: resolveRegionTz(req.authUser?.regionCode),
      label: '滞留数据告警运单查询',
    })

    if (!result.ok) {
      res.status(502).json({ ok: false, error: result.message })
      return
    }
    res.json({ ok: true, data: result.records })
  } catch {
    res.status(500).json({ ok: false, error: '运单查询失败' })
  }
})
