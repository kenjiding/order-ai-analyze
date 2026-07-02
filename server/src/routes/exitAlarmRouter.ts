import { Router, type Response } from 'express'
import { eq, asc } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { ExitAlarmSchedule } from '../db/schema'
import { readImileTokenFromRequest } from './imileAuth'
import { normalizeImileToken } from '../imile/shared'
import { fetchExitAlarmWaybills } from '../imile/exitAlarmWaybills'
import { buildExitAlarmCard } from '../feishu/buildExitAlarmCard'
import { hasExitAlarmImileToken, parseRouteCodes } from '../feishu/exitAlarmScheduledPush'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'

export const exitAlarmRouter = Router()

// ─── 供应商推送配置 CRUD ──────────────────────────────────────────────────────

exitAlarmRouter.get('/vendor-configs', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.exitAlarmPushConfigs)
      .orderBy(asc(schema.exitAlarmPushConfigs.createdAt))
    res.json({ ok: true, data: rows })
  } catch {
    res.status(500).json({ ok: false, error: '读取推送配置失败' })
  }
})

type ConfigBody = {
  vendorCode?: unknown
  vendorName?: unknown
  routeCode?: unknown
  webhookUrl?: unknown
  signingSecret?: unknown
  pushDescription?: unknown
  isDisabled?: unknown
}

exitAlarmRouter.post('/vendor-configs', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as ConfigBody
  if (
    typeof body.vendorCode !== 'string' || !body.vendorCode.trim() ||
    typeof body.vendorName !== 'string' || !body.vendorName.trim() ||
    typeof body.routeCode !== 'string' || !body.routeCode.trim() ||
    typeof body.webhookUrl !== 'string' || !body.webhookUrl.trim()
  ) {
    res.status(400).json({ ok: false, error: '缺少必填字段: vendorCode, vendorName, routeCode, webhookUrl' })
    return
  }
  try {
    const db = getDb()
    const [row] = await db
      .insert(schema.exitAlarmPushConfigs)
      .values({
        vendorCode: body.vendorCode.trim(),
        vendorName: body.vendorName.trim(),
        routeCode: body.routeCode.trim(),
        webhookUrl: body.webhookUrl.trim(),
        signingSecret: typeof body.signingSecret === 'string' && body.signingSecret.trim() ? body.signingSecret.trim() : null,
        pushDescription: typeof body.pushDescription === 'string' && body.pushDescription.trim() ? body.pushDescription.trim() : null,
        isDisabled: body.isDisabled === true,
        createdBy: req.authUser?.id ?? null,
      })
      .returning()
    res.status(201).json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '创建推送配置失败' })
  }
})

exitAlarmRouter.put('/vendor-configs/:id', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  const body = req.body as ConfigBody
  if (
    typeof body.vendorCode !== 'string' || !body.vendorCode.trim() ||
    typeof body.vendorName !== 'string' || !body.vendorName.trim() ||
    typeof body.routeCode !== 'string' ||
    typeof body.webhookUrl !== 'string' || !body.webhookUrl.trim()
  ) {
    res.status(400).json({ ok: false, error: '缺少必填字段: vendorCode, vendorName, webhookUrl' })
    return
  }
  try {
    const db = getDb()
    const [row] = await db
      .update(schema.exitAlarmPushConfigs)
      .set({
        vendorCode: body.vendorCode.trim(),
        vendorName: body.vendorName.trim(),
        routeCode: body.routeCode.trim(),
        webhookUrl: body.webhookUrl.trim(),
        signingSecret: typeof body.signingSecret === 'string' && body.signingSecret.trim() ? body.signingSecret.trim() : null,
        pushDescription: typeof body.pushDescription === 'string' && body.pushDescription.trim() ? body.pushDescription.trim() : null,
        isDisabled: body.isDisabled === true,
        updatedAt: new Date(),
      })
      .where(eq(schema.exitAlarmPushConfigs.id, id))
      .returning()
    if (!row) {
      res.status(404).json({ ok: false, error: '配置不存在' })
      return
    }
    res.json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '更新推送配置失败' })
  }
})

exitAlarmRouter.delete('/vendor-configs/:id', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  try {
    const db = getDb()
    await db.delete(schema.exitAlarmPushConfigs).where(eq(schema.exitAlarmPushConfigs.id, id))
    res.json({ ok: true })
  } catch {
    res.status(500).json({ ok: false, error: '删除推送配置失败' })
  }
})

// ─── 定时推送配置（全局单条） ─────────────────────────────────────────────────

type ScheduleBody = {
  weekdays?: unknown
  pushTimes?: unknown
  isEnabled?: unknown
  stationCode?: unknown
  imileToken?: unknown
}

type PublicExitAlarmSchedule = {
  id: string
  weekdays: ExitAlarmSchedule['weekdays']
  pushTimes: ExitAlarmSchedule['pushTimes']
  isEnabled: boolean
  stationCode: string
  updatedAt: Date
  hasImileToken: boolean
}

function toPublicSchedule(row: ExitAlarmSchedule): PublicExitAlarmSchedule {
  return {
    id: row.id,
    weekdays: row.weekdays,
    pushTimes: row.pushTimes,
    isEnabled: row.isEnabled,
    stationCode: row.stationCode,
    updatedAt: row.updatedAt,
    hasImileToken: hasExitAlarmImileToken(row),
  }
}

exitAlarmRouter.get('/schedule', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.exitAlarmSchedules)
      .orderBy(asc(schema.exitAlarmSchedules.createdAt))
      .limit(1)
    res.json({ ok: true, data: rows[0] ? toPublicSchedule(rows[0]) : null })
  } catch {
    res.status(500).json({ ok: false, error: '读取定时配置失败' })
  }
})

exitAlarmRouter.put('/schedule', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as ScheduleBody
  if (!Array.isArray(body.weekdays) || !Array.isArray(body.pushTimes)) {
    res.status(400).json({ ok: false, error: '缺少必填字段: weekdays, pushTimes' })
    return
  }
  try {
    const db = getDb()
    const existing = await db
      .select()
      .from(schema.exitAlarmSchedules)
      .orderBy(asc(schema.exitAlarmSchedules.createdAt))
      .limit(1)

    const stationCode = typeof body.stationCode === 'string' ? body.stationCode.trim() : ''
    const tokenFromBody = typeof body.imileToken === 'string' ? body.imileToken.trim() : ''
    const tokenFromHeader = readImileTokenFromRequest(req, body.imileToken)
    const nextImileToken = tokenFromBody || tokenFromHeader

    const isEnabled = body.isEnabled !== false
    const willEnable = isEnabled && body.pushTimes.length > 0 && body.weekdays.length > 0
    const existingToken = existing[0]?.imileToken?.trim() ?? ''
    if (willEnable && !nextImileToken && !existingToken && !hasExitAlarmImileToken(existing[0])) {
      res.status(400).json({
        ok: false,
        error: '启用定时推送需要 iMile token，请在全局设置中配置后重新保存',
      })
      return
    }

    let row: ExitAlarmSchedule
    if (existing.length > 0) {
      const [updated] = await db
        .update(schema.exitAlarmSchedules)
        .set({
          weekdays: body.weekdays,
          pushTimes: body.pushTimes,
          isEnabled,
          stationCode,
          ...(nextImileToken ? { imileToken: normalizeImileToken(nextImileToken) } : {}),
          updatedBy: req.authUser?.id ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.exitAlarmSchedules.id, existing[0].id))
        .returning()
      row = updated
    } else {
      const [created] = await db
        .insert(schema.exitAlarmSchedules)
        .values({
          weekdays: body.weekdays,
          pushTimes: body.pushTimes,
          isEnabled,
          stationCode,
          imileToken: nextImileToken ? normalizeImileToken(nextImileToken) : null,
          updatedBy: req.authUser?.id ?? null,
        })
        .returning()
      row = created
    }
    res.json({ ok: true, data: toPublicSchedule(row) })
  } catch {
    res.status(500).json({ ok: false, error: '保存定时配置失败' })
  }
})

// ─── 立即推送出仓告警 ─────────────────────────────────────────────────────────

exitAlarmRouter.post('/push-now', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  type PushNowBody = { stationCode?: unknown; date?: unknown; pushTime?: unknown }
  const body = req.body as PushNowBody

  if (typeof body.stationCode !== 'string' || !body.stationCode.trim()) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode' })
    return
  }
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date.trim())) {
    res.status(400).json({ ok: false, error: 'date 格式应为 YYYY-MM-DD' })
    return
  }

  const stationCode = body.stationCode.trim()
  const date = body.date.trim()
  const pushTime = typeof body.pushTime === 'string' && body.pushTime.trim() ? body.pushTime.trim() : '11:00'

  // 获取已启用的推送配置
  const db = getDb()
  const configs = await db
    .select()
    .from(schema.exitAlarmPushConfigs)
    .where(eq(schema.exitAlarmPushConfigs.isDisabled, false))
    .orderBy(asc(schema.exitAlarmPushConfigs.createdAt))

  if (configs.length === 0) {
    res.json({ ok: true, data: { pushedCount: 0, totalConfigs: 0, errors: [] } })
    return
  }

  // 获取运单数据（先到件取 waybillNo，再分批 searchWaybill）
  const result = await fetchExitAlarmWaybills({
    token,
    stationCode,
    dateStr: date,
    label: '出仓告警立即推送',
  })

  if (!result.ok) {
    res.status(502).json({ ok: false, error: `运单查询失败: ${result.message}` })
    return
  }

  type WaybillRow = {
    deliveryTime?: string | null
    consigneeRouteCode?: string | null
    [key: string]: unknown
  }
  const waybills = result.records as WaybillRow[]

  // 逐配置推送
  let pushedCount = 0
  const errors: string[] = []

  for (const config of configs) {
    const routeCodes = parseRouteCodes(config.routeCode)

    const vendorWaybills =
      routeCodes.length > 0
        ? waybills.filter((w) => routeCodes.includes((w.consigneeRouteCode ?? '').trim()))
        : waybills

    // 按 routeCode 分区统计：deliveryTime 为空 = 不达标
    const zoneBreakdown: Record<string, { pending: number; total: number }> = {}
    for (const w of vendorWaybills) {
      const zone = (w.consigneeRouteCode ?? '').trim() || 'Unknown route'
      if (!zoneBreakdown[zone]) zoneBreakdown[zone] = { pending: 0, total: 0 }
      zoneBreakdown[zone].total++
      if (!w.deliveryTime) zoneBreakdown[zone].pending++
    }

    const totalPending = Object.values(zoneBreakdown).reduce((s, v) => s + v.pending, 0)
    const totalWaybills = vendorWaybills.length

    // 无运单也推送（告知已全部正常或无数据）
    const card = buildExitAlarmCard({
      vendorName: config.vendorName,
      stationCode,
      date,
      pushTime,
      zoneBreakdown,
      totalPending,
      totalWaybills,
      pushDescription: config.pushDescription,
    })

    try {
      const webhookHref = parseSafeWebhookUrl(config.webhookUrl).href
      const payload: Record<string, unknown> = { msg_type: 'interactive', card }
      if (config.signingSecret) {
        const timestampSec = Math.floor(Date.now() / 1000)
        payload.timestamp = String(timestampSec)
        payload.sign = computeFeishuWebhookSign(config.signingSecret, timestampSec)
      }
      const upstream = await fetch(webhookHref, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const feishuData = (await upstream.json().catch(() => ({}))) as Record<string, unknown>
      const code = feishuData.code
      if (upstream.ok && typeof code === 'number' && code === 0) {
        pushedCount++
      } else {
        errors.push(`${config.vendorName}: 飞书返回 code=${String(code)}`)
      }
    } catch {
      errors.push(`${config.vendorName}: 网络错误`)
    }
  }

  res.json({
    ok: true,
    data: {
      pushedCount,
      totalConfigs: configs.length,
      errors,
    },
  })
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
    const result = await fetchExitAlarmWaybills({
      token,
      stationCode,
      dateStr,
      label: '出仓告警运单查询',
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
