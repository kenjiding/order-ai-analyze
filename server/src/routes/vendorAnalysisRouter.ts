import crypto from 'node:crypto'
import { Router, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { requirePermission, type AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import { createDeepSeekClient } from '../openaiClient'
import { fetchVendorStations, fetchVendors } from '../imile/vendorAnalysis'
import { readImileTokenFromRequest } from './imileAuth'
import { enqueueJob, getJobById } from '../jobs/queue'
import { VENDOR_ANALYZE_JOB_TYPE } from '../jobs/handlers'
import { canAccessJob, resolveEnqueueRegionCode, sendJobAccessDenied } from '../jobs/access'
import { listSupplierPushConfigs } from '../supplierPushConfigs'
import { purgeOldVendorDailyData } from '../vendorAnalysis/retention'

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

function normalizeVendorAnalyzeCode(code: string): string {
  return code.trim()
}

/** 相同筛选条件（region + 站点 + 日期 + 供应商）在此内生成同一个 key，命中 enqueueJob 的幂等去重 */
function buildVendorAnalyzeIdempotencyKey(input: {
  regionCode: string | null
  stationCodes: string[]
  referenceDate: string
  complaintStart: string
  complaintEnd: string
  vendorCodes: string[]
}): string {
  const region = input.regionCode ?? '_global_'
  const stations = [...new Set(input.stationCodes.map((s) => s.trim()).filter(Boolean))].sort().join(',')
  const vendors = [...new Set(input.vendorCodes.map((s) => s.trim()).filter(Boolean))].sort().join(',')
  return [
    'vendor.analyze:v1',
    region,
    stations,
    input.referenceDate,
    `${input.complaintStart}~${input.complaintEnd}`,
    vendors,
  ].join('|')
}

type AnalyzeAsyncBody = {
  stationCodes?: unknown
  referenceDate?: unknown
  complaintStart?: unknown
  complaintEnd?: unknown
  startTime?: unknown
  endTime?: unknown
  ticketStartTime?: unknown
  ticketEndTime?: unknown
  yesterdayStartTime?: unknown
  yesterdayEndTime?: unknown
  dayBeforeStartTime?: unknown
  dayBeforeEndTime?: unknown
  unprocessedStartTime?: unknown
  before11Date?: unknown
  dayBeforeDate?: unknown
  regionCode?: unknown
  force?: unknown
}

const ANALYZE_ASYNC_REQUIRED_STRING_FIELDS = [
  'referenceDate', 'complaintStart', 'complaintEnd',
  'startTime', 'endTime', 'ticketStartTime', 'ticketEndTime',
  'yesterdayStartTime', 'yesterdayEndTime', 'dayBeforeStartTime', 'dayBeforeEndTime',
  'unprocessedStartTime', 'before11Date', 'dayBeforeDate',
] as const

vendorAnalysisRouter.post('/analyze-async', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  const body = req.body as AnalyzeAsyncBody

  for (const field of ANALYZE_ASYNC_REQUIRED_STRING_FIELDS) {
    if (typeof body[field] !== 'string' || !(body[field] as string).trim()) {
      res.status(400).json({ ok: false, error: `缺少 ${field}` })
      return
    }
  }

  const stationCodes = Array.isArray(body.stationCodes)
    ? (body.stationCodes as string[]).filter((s) => typeof s === 'string' && s.trim())
    : []
  if (stationCodes.length === 0) {
    res.status(400).json({ ok: false, error: '缺少 stationCodes' })
    return
  }

  const regionResult = resolveEnqueueRegionCode(req, body.regionCode)
  if (regionResult === 'forbidden') { sendJobAccessDenied(res); return }
  if (regionResult === 'invalid') {
    res.status(400).json({ ok: false, error: '无效的 regionCode' })
    return
  }

  // vendorCodes 由服务端直接查统一供应商配置表得出；按分析目标州过滤，与车队配置的按州隔离保持一致
  // （超管未指定具体州时 regionResult 为 null，此时不限州，覆盖全部供应商配置）
  const db = getDb()
  const configRows = await listSupplierPushConfigs(regionResult ?? undefined)
  const vendorCodes = [...new Set(configRows.map((c) => normalizeVendorAnalyzeCode(c.vendorCode)).filter(Boolean))]

  const force = body.force === true
  const idempotencyKey = force
    ? null
    : buildVendorAnalyzeIdempotencyKey({
        regionCode: regionResult,
        stationCodes,
        referenceDate: body.referenceDate as string,
        complaintStart: body.complaintStart as string,
        complaintEnd: body.complaintEnd as string,
        vendorCodes,
      })

  const enqueuePayload = {
    imileToken: token,
    stationCodes,
    vendorCodes,
    referenceDate: body.referenceDate,
    startTime: body.startTime,
    endTime: body.endTime,
    ticketStartTime: body.ticketStartTime,
    ticketEndTime: body.ticketEndTime,
    yesterdayStartTime: body.yesterdayStartTime,
    yesterdayEndTime: body.yesterdayEndTime,
    dayBeforeStartTime: body.dayBeforeStartTime,
    dayBeforeEndTime: body.dayBeforeEndTime,
    unprocessedStartTime: body.unprocessedStartTime,
    before11Date: body.before11Date,
    dayBeforeDate: body.dayBeforeDate,
  }

  let job = await enqueueJob({
    type: VENDOR_ANALYZE_JOB_TYPE,
    payload: enqueuePayload,
    regionCode: regionResult,
    idempotencyKey,
    createdBy: req.authUser?.id ?? null,
    maxAttempts: 2,
  })

  // 幂等命中的任务可能是本次 vendor_analysis_snapshots 上线之前跑完的旧任务（只有文件 artifact，已被 TTL 清理），
  // 这种"已完成但取不到数据"的僵尸记录如果不处理，会因为 idempotencyKey 一直被命中、永远无法重新拉取
  if (job.status === 'succeeded' && idempotencyKey) {
    const [snapshot] = await db
      .select({ id: schema.vendorAnalysisSnapshots.id })
      .from(schema.vendorAnalysisSnapshots)
      .where(eq(schema.vendorAnalysisSnapshots.jobId, job.id))
      .limit(1)
    if (!snapshot) {
      await db.update(schema.jobs).set({ idempotencyKey: null }).where(eq(schema.jobs.id, job.id))
      job = await enqueueJob({
        type: VENDOR_ANALYZE_JOB_TYPE,
        payload: enqueuePayload,
        regionCode: regionResult,
        idempotencyKey,
        createdBy: req.authUser?.id ?? null,
        maxAttempts: 2,
      })
    }
  }

  res.status(202).json({ ok: true, data: { jobId: job.id, status: job.status } })
})

// analyze-async 任务的完整分析结果长期存于 vendor_analysis_snapshots，不走 jobs 表的文件 artifact（会被 TTL 清理）
vendorAnalysisRouter.get('/analyze-jobs/:jobId/snapshot', async (req: AuthenticatedRequest, res: Response) => {
  const jobId = String(req.params.jobId ?? '').trim()
  const job = await getJobById(jobId)
  if (!job) {
    res.status(404).json({ ok: false, error: '任务不存在' })
    return
  }
  if (!canAccessJob(req, job)) {
    sendJobAccessDenied(res)
    return
  }
  if (job.type !== VENDOR_ANALYZE_JOB_TYPE) {
    res.status(400).json({ ok: false, error: '任务类型不匹配' })
    return
  }

  const db = getDb()
  const [snapshot] = await db
    .select({ payload: schema.vendorAnalysisSnapshots.payload })
    .from(schema.vendorAnalysisSnapshots)
    .where(eq(schema.vendorAnalysisSnapshots.jobId, jobId))
    .orderBy(schema.vendorAnalysisSnapshots.createdAt)
    .limit(1)
  if (!snapshot) {
    res.status(404).json({ ok: false, error: '该任务暂无已保存的分析数据' })
    return
  }
  res.json({ ok: true, data: snapshot.payload })
})

// ─── 日报发布（供外部分享链接读取） ────────────────────────────────────────────

type DailyReportBody = {
  reportDate?: unknown
  stations?: unknown
  complaintDateRange?: unknown
  before11Date?: unknown
  dispatch24hDate?: unknown
  generatedAt?: unknown
  vendors?: unknown
  aiSummaries?: unknown
}

/**
 * 保存 openSnapshot 生成的日报快照（VendorSnapshotData 去掉 webhookConfigs）。
 * 只透传白名单字段入库，webhook 地址与签名密钥永不落到该表。
 */
vendorAnalysisRouter.post('/daily-reports', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as DailyReportBody
  if (typeof body.reportDate !== 'string' || !body.reportDate.trim()) {
    res.status(400).json({ ok: false, error: '缺少 reportDate' })
    return
  }
  if (!Array.isArray(body.vendors) || body.vendors.length === 0) {
    res.status(400).json({ ok: false, error: '缺少 vendors 数据' })
    return
  }
  const payload = {
    reportDate: body.reportDate.trim(),
    stations: Array.isArray(body.stations) ? body.stations : [],
    complaintDateRange: typeof body.complaintDateRange === 'string' ? body.complaintDateRange : '',
    before11Date: typeof body.before11Date === 'string' ? body.before11Date : '',
    dispatch24hDate: typeof body.dispatch24hDate === 'string' ? body.dispatch24hDate : '',
    generatedAt: typeof body.generatedAt === 'string' ? body.generatedAt : new Date().toISOString(),
    vendors: body.vendors,
    aiSummaries: body.aiSummaries && typeof body.aiSummaries === 'object' ? body.aiSummaries : undefined,
  }
  try {
    const db = getDb()
    const [row] = await db
      .insert(schema.vendorDailyReports)
      .values({
        reportDate: payload.reportDate,
        payload,
        createdBy: req.authUser?.id ?? null,
      })
      .onConflictDoUpdate({
        target: schema.vendorDailyReports.reportDate,
        set: { payload, createdBy: req.authUser?.id ?? null, createdAt: new Date() },
      })
      .returning({ id: schema.vendorDailyReports.id, createdAt: schema.vendorDailyReports.createdAt })

    // 按 (vendorCode, reportDate) 自动开通分享链接：已存在则跳过，不轮换 token（同一天重复发布不能让已发给供应商的链接失效）
    try {
      for (const vendor of payload.vendors as Array<{ vendorCode?: unknown; vendorName?: unknown }>) {
        const vendorCode = typeof vendor.vendorCode === 'string' ? vendor.vendorCode.trim() : ''
        const vendorName = typeof vendor.vendorName === 'string' ? vendor.vendorName.trim() : ''
        if (!vendorCode) continue
        await db
          .insert(schema.vendorShareLinks)
          .values({
            vendorCode,
            vendorName,
            reportDate: payload.reportDate,
            token: generateShareToken(),
            createdBy: req.authUser?.id ?? null,
          })
          .onConflictDoNothing({
            target: [schema.vendorShareLinks.vendorCode, schema.vendorShareLinks.reportDate],
          })
      }
    } catch (err) {
      console.error('[vendor-analysis] 自动开通分享链接失败', err)
    }

    void purgeOldVendorDailyData().catch((err) => {
      console.error('[vendor-analysis] 清理过期日报/分享链接失败', err)
    })

    res.status(201).json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '日报保存失败' })
  }
})

// ─── 供应商分享链接管理 ───────────────────────────────────────────────────────
// 链接按 (vendorCode, reportDate) 绑定，发布日报时自动开通；本节仅负责查询/重置/禁用。

const requireShare = requirePermission('btn:vendor-analysis:share')

function generateShareToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

vendorAnalysisRouter.get('/share-links', requireShare, async (req: AuthenticatedRequest, res: Response) => {
  const reportDate = typeof req.query.reportDate === 'string' ? req.query.reportDate.trim() : ''
  if (!reportDate) {
    res.status(400).json({ ok: false, error: '缺少 reportDate' })
    return
  }
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.vendorShareLinks)
      .where(eq(schema.vendorShareLinks.reportDate, reportDate))
      .orderBy(schema.vendorShareLinks.vendorName)
    res.json({ ok: true, data: rows })
  } catch {
    res.status(500).json({ ok: false, error: '读取分享链接失败' })
  }
})

/** 重置 token：旧链接立即失效 */
vendorAnalysisRouter.post('/share-links/:id/reset', requireShare, async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  try {
    const db = getDb()
    const [row] = await db
      .update(schema.vendorShareLinks)
      .set({ token: generateShareToken(), updatedAt: new Date() })
      .where(eq(schema.vendorShareLinks.id, id))
      .returning()
    if (!row) {
      res.status(404).json({ ok: false, error: '分享链接不存在' })
      return
    }
    res.json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '重置分享链接失败' })
  }
})

vendorAnalysisRouter.put('/share-links/:id', requireShare, async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  const body = req.body as { isDisabled?: unknown }
  if (typeof body.isDisabled !== 'boolean') {
    res.status(400).json({ ok: false, error: '缺少 isDisabled' })
    return
  }
  try {
    const db = getDb()
    const [row] = await db
      .update(schema.vendorShareLinks)
      .set({ isDisabled: body.isDisabled, updatedAt: new Date() })
      .where(eq(schema.vendorShareLinks.id, id))
      .returning()
    if (!row) {
      res.status(404).json({ ok: false, error: '分享链接不存在' })
      return
    }
    res.json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '更新分享链接失败' })
  }
})

// ─── AI 供应商总结分析 ───────────────────────────────────────────────────────

type VendorAiDriverInput = {
  courierName: string
  courierCode: string
  routeCode: string
  ofdCount: number
  /** 24H派签率，fraction */
  dispatchRate24h: number | null
  dispatch24hCount: number
  totalDispatchCount: number
  returnWarningCount: number
  /** 长尾单件数 */
  longTailCount: number
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

const VENDOR_AI_SYSTEM_PROMPTS: Record<'zh-CN' | 'en', string> = {
  'zh-CN': `你是 iMile Australia 的资深运营分析师，负责向各快递供应商提供有深度、可执行的数据分析报告。

【指标基准线】
- 11点前出仓率：≥99% 达标，[95%,99%) 预警，<95% 异常
- 24H派签率：≥95% 达标，[92%,95%) 预警，<92% 异常
- 客诉率：≤0.025% 达标，(0.025%,0.03%) 预警，≥0.03% 异常

【分析要求】针对每家供应商输出150~250字的专业中文分析，必须涵盖以下维度：
1. 供应商整体表现总结（对照基准，指出哪些指标有问题、偏差幅度，不只是重复数字）
2. 司机层面深入分析：
   - 点名24H派签率最低的2~3名司机及其路由、具体数值
   - 点名归班预警次数最多的司机，说明风险
   - 若存在长尾单较多的司机，说明待跟进件量及潜在风险
   - 若存在某条路由多名司机均表现差，判断可能是路线问题而非个人问题
3. 问题归因推断（基于数据，不要凭空猜测）
4. 具体可执行建议（涉及到人名或路由，而非"加强管理"之类的空话）

【格式要求】
- 流畅中文段落，不使用 markdown、分点符号、emoji
- 150~250字，言之有物，不堆砌废话
- 若某家供应商所有指标均达标，则以积极语气简要肯定（60~80字即可），并从司机数据中找出表现最优司机予以点名
- 禁止出现：AI、大模型、自动生成、人工智能

返回严格 JSON（UTF-8，无 markdown wrapper）：{"summaries":{"<vendorCode>":"<analysis>",...}}`,
  en: `You are a senior operations analyst at iMile Australia, producing in-depth, actionable performance reports for courier vendors.

[Metric baselines]
- Exit rate by 11:00: ≥99% on target, [95%,99%) warning, <95% critical
- 24h dispatch/sign-off rate: ≥95% on target, [92%,95%) warning, <92% critical
- Complaint rate: ≤0.025% on target, (0.025%,0.03%) warning, ≥0.03% critical

[Requirements] For each vendor, write a professional English analysis of 150–250 words covering:
1. Overall vendor performance vs baselines (which metrics miss target and by how much—not just repeating numbers)
2. Courier-level analysis:
   - Name the 2–3 couriers with the lowest 24h dispatch rates, their routes, and figures
   - Name couriers with the most return alerts and explain risk
   - If couriers have high long-tail counts, note follow-up volume and risk
   - If multiple couriers on the same route underperform, consider a route issue rather than individuals
3. Root-cause inference grounded in data (no speculation)
4. Concrete, actionable recommendations (name couriers or routes—avoid vague "improve management")

[Format]
- Fluent English paragraphs only; no markdown, bullet lists, or emoji
- 150–250 words; substantive, not filler
- If all metrics are on target, give brief positive feedback (60–80 words) and name top-performing couriers
- Do not mention: AI, LLM, auto-generated, artificial intelligence

Return strict JSON (UTF-8, no markdown wrapper): {"summaries":{"<vendorCode>":"<analysis>",...}}`,
}

const VENDOR_AI_USER_PROMPTS: Record<'zh-CN' | 'en', (count: number) => string> = {
  'zh-CN': (count) => `以下是今日 ${count} 家供应商的运营数据，请逐一进行深度分析：`,
  en: (count) => `Below is today's operational data for ${count} vendor(s). Analyze each in depth:`,
}

function resolveVendorAiLocale(raw: unknown): 'zh-CN' | 'en' {
  return raw === 'en' ? 'en' : 'zh-CN'
}

vendorAnalysisRouter.post('/ai-summary', async (req: AuthenticatedRequest, res: Response) => {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    res.status(503).json({ ok: false, error: '未配置 DEEPSEEK_API_KEY' })
    return
  }

  const { vendors, locale: rawLocale } = req.body as { vendors?: VendorAiInput[]; locale?: unknown }
  if (!Array.isArray(vendors) || vendors.length === 0) {
    res.status(400).json({ ok: false, error: '缺少 vendors 数据' })
    return
  }

  const locale = resolveVendorAiLocale(rawLocale)
  const userPrompt = `${VENDOR_AI_USER_PROMPTS[locale](vendors.length)}\n${JSON.stringify(vendors, null, 2)}`

  try {
    const client = createDeepSeekClient(apiKey)
    const model = process.env.DEEPSEEK_VENDOR_MODEL?.trim() ?? 'deepseek-chat'
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.4,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: VENDOR_AI_SYSTEM_PROMPTS[locale] },
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
