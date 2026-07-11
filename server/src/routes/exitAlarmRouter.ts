import { Router, type Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { ExitAlarmSchedule } from '../db/schema'
import { readImileTokenFromRequest } from './imileAuth'
import { normalizeImileToken } from '../imile/shared'
import { fetchWaybillDetailsByInboundIndex, getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz } from '../imile/ausTimezone'
import {
  buildExitAlarmZoneBreakdown,
  computeBefore11ThresholdMs,
  isBefore11Exit,
} from '../imile/before11Exit'
import { buildExitAlarmCard } from '../feishu/buildExitAlarmCard'
import { hasExitAlarmImileToken } from '../feishu/exitAlarmScheduledPush'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import {
  listPushableSupplierPushConfigsByIds,
  parsePushConfigIds,
  parseRouteCodes,
  parseRouteCodeWhitelistSet,
  supplierDisplayName,
} from '../supplierPushConfigs'
import { exitAlarmScheduledScope } from '../supplierConfigScopes/exitAlarmScheduled'

export const exitAlarmRouter = Router()

// ─── 定时推送配置（按账号隔离，每个账号最多一条） ────────────────────────────────

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
  /** 拥有该配置的账号所属州/区域，决定 pushTimes/weekdays 按哪个时区判断；只读，随账号信息变化 */
  regionCode: string | null
  pushConfigIds: string[]
  updatedAt: Date
  hasImileToken: boolean
}

async function toPublicSchedule(row: ExitAlarmSchedule, regionCode: string | null): Promise<PublicExitAlarmSchedule> {
  const pushConfigIds = await exitAlarmScheduledScope.loadEnabledConfigIds()
  return {
    id: row.id,
    weekdays: row.weekdays,
    pushTimes: row.pushTimes,
    isEnabled: row.isEnabled,
    stationCode: row.stationCode,
    regionCode,
    pushConfigIds,
    updatedAt: row.updatedAt,
    hasImileToken: hasExitAlarmImileToken(row),
  }
}

async function loadOwnScheduleRow(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<ExitAlarmSchedule | null> {
  const rows = await db
    .select()
    .from(schema.exitAlarmSchedules)
    .where(eq(schema.exitAlarmSchedules.userId, userId))
    .limit(1)
  return rows[0] ?? null
}

exitAlarmRouter.get('/schedule', async (req: AuthenticatedRequest, res: Response) => {
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

exitAlarmRouter.put('/schedule', async (req: AuthenticatedRequest, res: Response) => {
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
    const tokenFromBody = typeof body.imileToken === 'string' ? body.imileToken.trim() : ''
    const tokenFromHeader = readImileTokenFromRequest(req, body.imileToken)
    const nextImileToken = tokenFromBody || tokenFromHeader

    const isEnabled = body.isEnabled !== false
    const willEnable = isEnabled && body.pushTimes.length > 0 && body.weekdays.length > 0
    const existingToken = existing?.imileToken?.trim() ?? ''
    if (willEnable && !nextImileToken && !existingToken && !hasExitAlarmImileToken(existing)) {
      res.status(400).json({
        ok: false,
        error: '启用定时推送需要 iMile token，请在全局设置中配置后重新保存',
      })
      return
    }

    let row: ExitAlarmSchedule
    if (existing) {
      const [updated] = await db
        .update(schema.exitAlarmSchedules)
        .set({
          weekdays: body.weekdays,
          pushTimes: body.pushTimes,
          isEnabled,
          stationCode,
          ...(nextImileToken ? { imileToken: normalizeImileToken(nextImileToken) } : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.exitAlarmSchedules.id, existing.id))
        .returning()
      row = updated
    } else {
      const [created] = await db
        .insert(schema.exitAlarmSchedules)
        .values({
          userId,
          weekdays: body.weekdays,
          pushTimes: body.pushTimes,
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

exitAlarmRouter.put('/schedule/push-config-ids', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  const body = req.body as { pushConfigIds?: unknown }
  const pushConfigIds = parsePushConfigIds(body.pushConfigIds)
  try {
    await exitAlarmScheduledScope.saveEnabledConfigIds(pushConfigIds)
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

// ─── 立即推送出仓告警 ─────────────────────────────────────────────────────────

exitAlarmRouter.post('/push-now', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  type PushNowBody = { stationCode?: unknown; date?: unknown; configIds?: unknown }
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
    ? body.configIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    : []
  if (configIds.length === 0) {
    res.status(400).json({ ok: false, error: '请至少选择一个供应商配置' })
    return
  }

  const stationCode = body.stationCode.trim()
  const date = body.date.trim()
  const tz = resolveRegionTz(req.authUser?.regionCode)
  const { timeHHmm: pushTime } = getRegionNow(tz)

  const configs = await listPushableSupplierPushConfigsByIds(configIds)

  if (configs.length === 0) {
    res.status(400).json({ ok: false, error: '所选供应商均不可用（未配置 Webhook）' })
    return
  }

  // 获取运单数据（先到件取 waybillNo，再分批 searchWaybill）
  const result = await fetchWaybillDetailsByInboundIndex({
    token,
    stationCode,
    dateStr: date,
    tz,
    label: '出仓告警立即推送',
  })

  if (!result.ok) {
    res.status(502).json({ ok: false, error: `运单查询失败: ${result.message}` })
    return
  }

  type WaybillRow = {
    waybillNo?: string | null
    deliveryTime?: string | null
    consigneeRouteCode?: string | null
    courier?: string | null
    courierCode?: string | null
    courierVendorCode?: string | null
    [key: string]: unknown
  }
  const waybills = result.records as WaybillRow[]
  const before11ThresholdMs = computeBefore11ThresholdMs(date, tz)

  type ExportWaybillRow = {
    waybillNo: string
    routeCode: string
    deliveryTime: string
    courier: string
    courierCode: string
    status: '达标' | '未达标'
  }
  type ExportSheet = {
    vendorName: string
    metCount: number
    unmetCount: number
    rows: ExportWaybillRow[]
  }

  // 逐配置推送；同时组装导出明细（按供应商分 sheet）
  let pushedCount = 0
  const errors: string[] = []
  const exportSheets: ExportSheet[] = []

  for (const config of configs) {
    const routeCodes = parseRouteCodes(config.routeCode)
    const whitelist = parseRouteCodeWhitelistSet(config.routeCodeWhitelist)
    const vendorName = supplierDisplayName(config)

    const vendorWaybills = waybills.filter((w) => {
      const code = (w.consigneeRouteCode ?? '').trim()
      if (routeCodes.length > 0 && !routeCodes.includes(code)) return false
      if (whitelist.has(code)) return false
      return true
    })

    const zoneBreakdown = buildExitAlarmZoneBreakdown(vendorWaybills, before11ThresholdMs)

    const totalPending = Object.values(zoneBreakdown).reduce((s, v) => s + v.pending, 0)
    const totalWaybills = vendorWaybills.length

    const unmetRows: ExportWaybillRow[] = []
    const metRows: ExportWaybillRow[] = []
    for (const w of vendorWaybills) {
      const deliveryTime = typeof w.deliveryTime === 'string' && w.deliveryTime ? w.deliveryTime : ''
      const met = isBefore11Exit(deliveryTime || null, before11ThresholdMs)
      const row: ExportWaybillRow = {
        waybillNo: typeof w.waybillNo === 'string' ? w.waybillNo.trim() : '',
        routeCode: (w.consigneeRouteCode ?? '').trim() || 'Unknown route',
        deliveryTime,
        courier: typeof w.courier === 'string' ? w.courier.trim() : '',
        courierCode: typeof w.courierCode === 'string' ? w.courierCode.trim() : '',
        status: met ? '达标' : '未达标',
      }
      if (met) metRows.push(row)
      else unmetRows.push(row)
    }
    exportSheets.push({
      vendorName,
      metCount: metRows.length,
      unmetCount: unmetRows.length,
      // 未达标在前，便于告警核对
      rows: [...unmetRows, ...metRows],
    })

    // 无运单也推送（告知已全部正常或无数据）
    const card = buildExitAlarmCard({
      vendorName,
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
        errors.push(`${vendorName}: 飞书返回 code=${String(code)}`)
      }
    } catch (err) {
      const cause = err instanceof Error ? (err.cause as { code?: string } | undefined)?.code : undefined
      const reason = cause ?? (err instanceof Error ? err.message : String(err))
      console.error(`[exit-alarm/push-now] ${vendorName} 推送异常:`, err)
      errors.push(`${vendorName}: 网络错误(${reason})`)
    }
  }

  res.json({
    ok: true,
    data: {
      pushedCount,
      totalConfigs: configs.length,
      errors,
      stationCode,
      date,
      exportSheets,
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
    const result = await fetchWaybillDetailsByInboundIndex({
      token,
      stationCode,
      dateStr,
      tz: resolveRegionTz(req.authUser?.regionCode),
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
