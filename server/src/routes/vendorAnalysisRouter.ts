import { Router, type Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import { fetchFineBi24hDispatchMetricsBatch } from '../imile/fineBi24hDispatchMetrics'
import { fetchFineBiVendorMetricsBatch } from '../imile/fineBiVendorMetrics'
import {
  fetchVendorStations,
  fetchVendors,
  fetchComplaintTickets,
  fetchUnprocessedTickets,
  fetchLongTailOrders,
  fetchVendorWaybills,
} from '../imile/vendorAnalysis'
import { fetchDriverWaybills, fetchDriverReturnWarning } from '../imile/driverPerformance'
import { readImileTokenFromRequest } from './imileAuth'
import { getCachedWaybills, makeWaybillCacheKey, setCachedWaybills } from '../imile/waybillCache'
import { Semaphore } from '../imile/semaphore'

// 同一时刻只允许 1 个 driver-waybills 分页请求跑，防止两路并发触发 iMile 限流
const driverWaybillSemaphore = new Semaphore(1)

export const vendorAnalysisRouter = Router()

// ─── iMile 代理端点 ────────────────────────────────────────────────────────

vendorAnalysisRouter.get('/stations', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const result = await fetchVendorStations(token)
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

vendorAnalysisRouter.post('/vendors', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const result = await fetchVendors(token)
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

vendorAnalysisRouter.post('/complaint-tickets', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const body = req.body as { startTime?: string; endTime?: string }
  if (!body.startTime || !body.endTime) {
    res.status(400).json({ ok: false, error: '缺少 startTime 或 endTime' })
    return
  }
  const result = await fetchComplaintTickets(token, {
    startTime: body.startTime,
    endTime: body.endTime,
  })
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

vendorAnalysisRouter.post('/unprocessed-tickets', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const body = req.body as { startTime?: string; endTime?: string }
  if (!body.startTime || !body.endTime) {
    res.status(400).json({ ok: false, error: '缺少 startTime 或 endTime' })
    return
  }
  const result = await fetchUnprocessedTickets(token, {
    startTime: body.startTime,
    endTime: body.endTime,
  })
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

vendorAnalysisRouter.post('/long-tail-orders', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const body = req.body as { stationCodes?: unknown }
  const stationCodes = Array.isArray(body.stationCodes)
    ? (body.stationCodes as string[]).filter((s) => typeof s === 'string')
    : []
  const result = await fetchLongTailOrders(token, { stationCodes })
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

vendorAnalysisRouter.post('/finebi-metrics', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as {
    endDate?: string
    vendorCodes?: unknown
    stationCodes?: unknown
    fineBiConnection?: {
      reportId?: unknown
      shareLink?: unknown
      baseUrl?: unknown
      authToken?: unknown
      widgetDataUrl?: unknown
    }
  }
  const endDate = typeof body.endDate === 'string' ? body.endDate.trim() : ''
  if (!endDate) {
    res.status(400).json({ ok: false, error: '缺少 endDate' })
    return
  }
  const vendorCodes = Array.isArray(body.vendorCodes)
    ? (body.vendorCodes as string[]).filter((s) => typeof s === 'string' && s.trim())
    : []
  const stationCodes = Array.isArray(body.stationCodes)
    ? (body.stationCodes as string[]).filter((s) => typeof s === 'string' && s.trim())
    : []
  if (!stationCodes.length) {
    res.status(400).json({ ok: false, error: '缺少 stationCodes' })
    return
  }

  const conn = body.fineBiConnection
  if (!conn || typeof conn.reportId !== 'string' || typeof conn.shareLink !== 'string') {
    res.status(400).json({ ok: false, error: '缺少 fineBiConnection（reportId、shareLink）' })
    return
  }

  const result = await fetchFineBiVendorMetricsBatch({
    endDate,
    vendorCodes,
    stationCodes,
    connection: {
      reportId: conn.reportId.trim(),
      shareLink: conn.shareLink.trim(),
      baseUrl: typeof conn.baseUrl === 'string' ? conn.baseUrl.trim() : undefined,
      authToken: typeof conn.authToken === 'string' ? conn.authToken.trim() : undefined,
      widgetDataUrl: typeof conn.widgetDataUrl === 'string' ? conn.widgetDataUrl.trim() : undefined,
    },
  })
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

vendorAnalysisRouter.post('/finebi-24h-dispatch-metrics', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as {
    startDate?: string
    endDate?: string
    vendorCodes?: unknown
    stationCodes?: unknown
    country?: string
    fineBiConnection?: {
      reportId?: unknown
      shareLink?: unknown
      baseUrl?: unknown
      authToken?: unknown
      widgetDataUrl?: unknown
    }
  }
  const startDate = typeof body.startDate === 'string' ? body.startDate.trim() : ''
  const endDate = typeof body.endDate === 'string' ? body.endDate.trim() : ''
  if (!startDate || !endDate) {
    res.status(400).json({ ok: false, error: '缺少 startDate 或 endDate' })
    return
  }
  const vendorCodes = Array.isArray(body.vendorCodes)
    ? (body.vendorCodes as string[]).filter((s) => typeof s === 'string' && s.trim())
    : []
  const stationCodes = Array.isArray(body.stationCodes)
    ? (body.stationCodes as string[]).filter((s) => typeof s === 'string' && s.trim())
    : []
  if (!stationCodes.length) {
    res.status(400).json({ ok: false, error: '缺少 stationCodes' })
    return
  }

  const conn = body.fineBiConnection
  if (!conn || typeof conn.reportId !== 'string' || typeof conn.shareLink !== 'string') {
    res.status(400).json({ ok: false, error: '缺少 fineBiConnection（reportId、shareLink）' })
    return
  }

  const result = await fetchFineBi24hDispatchMetricsBatch({
    startDate,
    endDate,
    vendorCodes,
    stationCodes,
    country: typeof body.country === 'string' ? body.country.trim() : undefined,
    connection: {
      reportId: conn.reportId.trim(),
      shareLink: conn.shareLink.trim(),
      baseUrl: typeof conn.baseUrl === 'string' ? conn.baseUrl.trim() : undefined,
      authToken: typeof conn.authToken === 'string' ? conn.authToken.trim() : undefined,
      widgetDataUrl: typeof conn.widgetDataUrl === 'string' ? conn.widgetDataUrl.trim() : undefined,
    },
  })
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

function slimWaybill(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>
  return {
    courierVendorCode: r.courierVendorCode,
    courierCode: r.courierCode,
    courier: r.courier,
    consigneeRouteCode: r.consigneeRouteCode,
    deliveryTime: r.deliveryTime,
    signDate: r.signDate,
  }
}

vendorAnalysisRouter.post('/waybills', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const body = req.body as { startTime?: string; endTime?: string }
  if (!body.startTime || !body.endTime) {
    res.status(400).json({ ok: false, error: '缺少 startTime 或 endTime' })
    return
  }
  const cacheKey = makeWaybillCacheKey(token, body.startTime, body.endTime)
  const cached = getCachedWaybills(cacheKey)
  if (cached) {
    res.json({ ok: true, data: cached })
    return
  }

  const result = await fetchVendorWaybills(token, {
    startTime: body.startTime,
    endTime: body.endTime,
  })
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  const slimmed = result.data.map(slimWaybill)
  setCachedWaybills(cacheKey, slimmed)
  res.json({ ok: true, data: slimmed })
})

vendorAnalysisRouter.post('/driver-waybills', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const body = req.body as { startTime?: string; endTime?: string }
  const startTime = typeof body.startTime === 'string' ? body.startTime.trim() : ''
  const endTime = typeof body.endTime === 'string' ? body.endTime.trim() : ''
  if (!startTime || !endTime) {
    res.status(400).json({ ok: false, error: '缺少 startTime 或 endTime' })
    return
  }
  const result = await driverWaybillSemaphore.run(() =>
    fetchDriverWaybills(token, { startTime, endTime }),
  )
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

vendorAnalysisRouter.post('/driver-return-warning', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const body = req.body as { stationCodes?: unknown }
  const stationCodes = Array.isArray(body.stationCodes)
    ? (body.stationCodes as string[]).filter((s) => typeof s === 'string' && s.trim())
    : []
  const result = await fetchDriverReturnWarning(token, { stationCodes })
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

// ─── 推送配置 CRUD ────────────────────────────────────────────────────────

vendorAnalysisRouter.get('/configs', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.vendorAnalysisPushConfigs)
      .orderBy(schema.vendorAnalysisPushConfigs.createdAt)
    res.json({ ok: true, data: rows })
  } catch {
    res.status(500).json({ ok: false, error: '读取配置失败' })
  }
})

type ConfigBody = {
  vendorCode?: unknown
  vendorName?: unknown
  webhookUrl?: unknown
  signingSecret?: unknown
  pushDescription?: unknown
  isDisabled?: unknown
}

vendorAnalysisRouter.post('/configs', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as ConfigBody
  if (
    typeof body.vendorCode !== 'string' ||
    !body.vendorCode.trim() ||
    typeof body.vendorName !== 'string' ||
    !body.vendorName.trim() ||
    typeof body.webhookUrl !== 'string' ||
    !body.webhookUrl.trim()
  ) {
    res.status(400).json({ ok: false, error: '缺少必填字段: vendorCode, vendorName, webhookUrl' })
    return
  }
  try {
    const db = getDb()
    const [row] = await db
      .insert(schema.vendorAnalysisPushConfigs)
      .values({
        vendorCode: body.vendorCode.trim(),
        vendorName: body.vendorName.trim(),
        webhookUrl: body.webhookUrl.trim(),
        signingSecret:
          typeof body.signingSecret === 'string' && body.signingSecret.trim()
            ? body.signingSecret.trim()
            : null,
        pushDescription:
          typeof body.pushDescription === 'string' && body.pushDescription.trim()
            ? body.pushDescription.trim()
            : null,
        isDisabled: body.isDisabled === true,
        createdBy: req.authUser?.id ?? null,
      })
      .returning()
    res.status(201).json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '创建配置失败' })
  }
})

vendorAnalysisRouter.put('/configs/:id', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  const body = req.body as ConfigBody
  if (
    typeof body.vendorCode !== 'string' ||
    !body.vendorCode.trim() ||
    typeof body.vendorName !== 'string' ||
    !body.vendorName.trim() ||
    typeof body.webhookUrl !== 'string' ||
    !body.webhookUrl.trim()
  ) {
    res.status(400).json({ ok: false, error: '缺少必填字段: vendorCode, vendorName, webhookUrl' })
    return
  }
  try {
    const db = getDb()
    const [row] = await db
      .update(schema.vendorAnalysisPushConfigs)
      .set({
        vendorCode: body.vendorCode.trim(),
        vendorName: body.vendorName.trim(),
        webhookUrl: body.webhookUrl.trim(),
        signingSecret:
          typeof body.signingSecret === 'string' && body.signingSecret.trim()
            ? body.signingSecret.trim()
            : null,
        pushDescription:
          typeof body.pushDescription === 'string' && body.pushDescription.trim()
            ? body.pushDescription.trim()
            : null,
        isDisabled: body.isDisabled === true,
        updatedAt: new Date(),
      })
      .where(eq(schema.vendorAnalysisPushConfigs.id, id))
      .returning()
    if (!row) {
      res.status(404).json({ ok: false, error: '配置不存在' })
      return
    }
    res.json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '更新配置失败' })
  }
})

vendorAnalysisRouter.delete('/configs/:id', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  try {
    const db = getDb()
    await db
      .delete(schema.vendorAnalysisPushConfigs)
      .where(eq(schema.vendorAnalysisPushConfigs.id, id))
    res.json({ ok: true })
  } catch {
    res.status(500).json({ ok: false, error: '删除配置失败' })
  }
})
