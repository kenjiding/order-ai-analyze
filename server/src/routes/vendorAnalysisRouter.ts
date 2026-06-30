import { Router, type Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import { createDeepSeekClient } from '../openaiClient'
import {
  fetchVendorStations,
  fetchVendors,
  fetchComplaintTickets,
  fetchUnprocessedTickets,
  fetchLongTailOrders,
  fetchVendorWaybills,
  fetchBefore11ExitRates,
} from '../imile/vendorAnalysis'
import { fetchDriverWaybills, fetchDriverReturnWarning } from '../imile/driverPerformance'
import { readImileTokenFromRequest } from './imileAuth'
import { getCachedWaybills, makeWaybillCacheKey, setCachedWaybills } from '../imile/waybillCache'
import { Semaphore } from '../imile/semaphore'

// 三个 searchWaybill 类接口共享此锁，同一时刻只允许 1 个在跑，防止触发 iMile 限流
const waybillSearchSemaphore = new Semaphore(1)

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

vendorAnalysisRouter.post('/before11-exit-rate', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const body = req.body as { startTime?: string; endTime?: string; vendorCodes?: unknown }
  const startTime = typeof body.startTime === 'string' ? body.startTime.trim() : ''
  const endTime = typeof body.endTime === 'string' ? body.endTime.trim() : ''
  if (!startTime || !endTime) {
    res.status(400).json({ ok: false, error: '缺少 startTime 或 endTime' })
    return
  }
  const vendorCodes = Array.isArray(body.vendorCodes)
    ? (body.vendorCodes as string[]).filter((s) => typeof s === 'string' && s.trim())
    : []

  const result = await waybillSearchSemaphore.run(() =>
    fetchBefore11ExitRates(token, {
      startTime,
      endTime,
      vendorCodes,
    }),
  )
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.message })
    return
  }
  res.json({ ok: true, data: result.data })
})

function slimWaybill(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>
  return {
    waybillNo: r.waybillNo,
    courierVendorCode: r.courierVendorCode,
    courierCode: r.courierCode,
    courier: r.courier,
    consigneeRouteCode: r.consigneeRouteCode,
    deliveryTime: r.deliveryTime,
    signDate: r.signDate,
    lastScanSiteCode: r.lastScanSiteCode,
    lastScanSiteName: r.lastScanSiteName,
    lastProblemDate: r.lastProblemDate,
  }
}

vendorAnalysisRouter.post('/waybills', async (req: AuthenticatedRequest, res: Response) => {
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
  const cacheKey = makeWaybillCacheKey(token, startTime, endTime)
  const cached = getCachedWaybills(cacheKey)
  if (cached) {
    res.json({ ok: true, data: cached })
    return
  }

  const result = await waybillSearchSemaphore.run(() =>
    fetchVendorWaybills(token, { startTime, endTime }),
  )
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
  const result = await waybillSearchSemaphore.run(() =>
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

// ─── AI 供应商总结分析 ───────────────────────────────────────────────────────

type VendorAiDriverInput = {
  courierName: string
  courierCode: string
  routeCode: string
  ofdCount: number
  /** 11点前出仓率，fraction */
  before11ExitRate: number | null
  /** 24H派签率，fraction */
  dispatchRate24h: number | null
  dispatch24hCount: number
  totalDispatchCount: number
  returnWarningCount: number
}

type VendorAiInput = {
  vendorCode: string
  vendorName: string
  /** 11点前出仓率，fraction */
  before11ExitRate: number | null
  /** 24H派签率，fraction */
  dispatchRate24h: number | null
  /** 客诉率，fraction */
  complaintRate: number
  complaintCount: number
  waybillCount: number
  unprocessedTicketCount: number
  longTailCount: number
  /** 按归班预警数降序、再按派签率升序排列，最多 30 条 */
  drivers: VendorAiDriverInput[]
}

const VENDOR_AI_SYSTEM_PROMPT = `你是 iMile Australia 的资深运营分析师，负责向各快递供应商提供有深度、可执行的数据分析报告。

【指标基准线】
- 11点前出仓率：≥99% 达标，[95%,99%) 预警，<95% 异常
- 24H派签率：≥95% 达标，[92%,95%) 预警，<92% 异常
- 客诉率：≤0.025% 达标，(0.025%,0.03%) 预警，≥0.03% 异常

【分析要求】针对每家供应商输出150~250字的专业中文分析，必须涵盖以下维度：
1. 供应商整体表现总结（对照基准，指出哪些指标有问题、偏差幅度，不只是重复数字）
2. 司机层面深入分析：
   - 点名24H派签率最低的2~3名司机及其路由、具体数值
   - 点名归班预警次数最多的司机，说明风险
   - 若存在某条路由多名司机均表现差，判断可能是路线问题而非个人问题
3. 问题归因推断（基于数据，不要凭空猜测）
4. 具体可执行建议（涉及到人名或路由，而非"加强管理"之类的空话）

【格式要求】
- 流畅中文段落，不使用 markdown、分点符号、emoji
- 150~250字，言之有物，不堆砌废话
- 若某家供应商所有指标均达标，则以积极语气简要肯定（60~80字即可），并从司机数据中找出表现最优司机予以点名
- 禁止出现：AI、大模型、自动生成、人工智能

返回严格 JSON（UTF-8，无 markdown wrapper）：{"summaries":{"<vendorCode>":"<analysis>",...}}`

vendorAnalysisRouter.post('/ai-summary', async (req: AuthenticatedRequest, res: Response) => {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    res.status(503).json({ ok: false, error: '未配置 DEEPSEEK_API_KEY' })
    return
  }

  const { vendors } = req.body as { vendors?: VendorAiInput[] }
  if (!Array.isArray(vendors) || vendors.length === 0) {
    res.status(400).json({ ok: false, error: '缺少 vendors 数据' })
    return
  }

  const userPrompt = `以下是今日 ${vendors.length} 家供应商的运营数据，请逐一进行深度分析：\n${JSON.stringify(vendors, null, 2)}`

  try {
    const client = createDeepSeekClient(apiKey)
    const model = process.env.DEEPSEEK_VENDOR_MODEL?.trim() ?? 'deepseek-chat'
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.4,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: VENDOR_AI_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    })
    const raw = completion.choices[0]?.message.content ?? '{}'
    const parsed = JSON.parse(raw) as { summaries?: Record<string, string> }
    res.json({ ok: true, data: parsed.summaries ?? {} })
  } catch (err) {
    res.status(502).json({ ok: false, error: `AI 分析失败: ${err instanceof Error ? err.message : String(err)}` })
  }
})
