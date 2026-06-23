import { Router, type Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import {
  fetchVendorStations,
  fetchVendors,
  fetchComplaintTickets,
  fetchUnprocessedTickets,
  fetchLongTailOrders,
  fetchVendorWaybills,
} from '../imile/vendorAnalysis'
import { readImileTokenFromRequest } from './imileAuth'

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
  const result = await fetchVendorWaybills(token, {
    startTime: body.startTime,
    endTime: body.endTime,
  })
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
