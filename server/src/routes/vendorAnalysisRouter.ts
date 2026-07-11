import crypto from 'node:crypto'
import { Router, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { requirePermission, type AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import { createDeepSeekClient } from '../openaiClient'
import { fetchVendorStations, fetchVendors } from '../imile/vendorAnalysis'
import { readImileTokenFromRequest } from './imileAuth'
import { enqueueJob, getJobById, updateJobPayload } from '../jobs/queue'
import { VENDOR_ANALYZE_JOB_TYPE } from '../jobs/handlers'
import { canAccessJob, resolveEnqueueRegionCode, sendJobAccessDenied } from '../jobs/access'
import { listSupplierPushConfigs, parseRouteCodes } from '../supplierPushConfigs'
import { purgeOldVendorDailyData } from '../vendorAnalysis/retention'
import {
  buildVendorAiSystemPrompt,
  parseVendorAnalysisDataSources,
  resolveVendorAnalysisDataSources,
  type VendorAnalysisDataSource,
} from '../vendorAnalysis/metricsCatalog'

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

/**
 * 相同筛选条件（region + 站点 + 日期 + 供应商 + 数据源集合）在此内生成同一个 key，命中 enqueueJob 的幂等去重。
 * dataSources 参与 key：勾选指标集合不同 → 需要抓取的数据不同 → 不能命中旧任务（否则缺数据）。
 * v1 → v2：老 key 永不再命中，避免命中无 dataSources 字段的历史任务。
 * v2 → v3：供应商/数据源列表改为 sha256，避免 jobs.idempotency_key varchar(255) 溢出。
 */
function buildVendorAnalyzeIdempotencyKey(input: {
  regionCode: string | null
  stationCodes: string[]
  referenceDate: string
  complaintStart: string
  complaintEnd: string
  vendorCodes: string[]
  dataSources: VendorAnalysisDataSource[]
  routeCodeWhitelistByVendor: Record<string, string[]>
}): string {
  const region = input.regionCode ?? '_global_'
  const stations = [...new Set(input.stationCodes.map((s) => s.trim()).filter(Boolean))].sort().join(',')
  const vendors = [...new Set(input.vendorCodes.map((s) => s.trim()).filter(Boolean))].sort().join(',')
  // 白名单变化会改变统计口径，需参与幂等 key，避免编辑白名单后复用旧结果
  const whitelistText = Object.entries(input.routeCodeWhitelistByVendor)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([vendor, codes]) => `${vendor}:${[...codes].sort().join(',')}`)
    .join(';')
  const scopeHash = crypto
    .createHash('sha256')
    .update(`${vendors}\0${input.dataSources.join(',')}\0${whitelistText}`)
    .digest('hex')
  return [
    'vendor.analyze:v3',
    region,
    stations,
    input.referenceDate,
    `${input.complaintStart}~${input.complaintEnd}`,
    scopeHash,
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
  metricKeys?: unknown
  /** 增量拉取：前端直接指定本次要抓取的数据源，跳过 metricKeys → 并集 的解析。传了则优先于 metricKeys */
  dataSources?: unknown
  /** 输出配置：本任务的推送供应商范围（配置 id 列表）+ AI 总结开关。不参与分析、不影响幂等，仅落库供查看/编辑 */
  pushEnabledIds?: unknown
  aiSummaryEnabled?: unknown
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

  // metricKeys 独立于 dataSources 解析：即便本次是增量拉取（走 dataSources 分支），前端仍会带上当前完整的勾选
  // 集合，单纯落库供「查看数据」还原指标配置用，不参与本次抓取范围计算（抓取范围只看 dataSources）
  let metricKeys: string[] | null = null
  if (body.metricKeys !== undefined) {
    if (!Array.isArray(body.metricKeys) || body.metricKeys.some((k) => typeof k !== 'string')) {
      res.status(400).json({ ok: false, error: '无效的 metricKeys' })
      return
    }
    metricKeys = body.metricKeys as string[]
  }

  // dataSources 显式指定（增量拉取，只补缺失的数据源）→ 优先于 metricKeys 解析；
  // 否则 metricKeys 不传（老客户端）→ 全量抓取，传了则按勾选指标解析需要的数据源并集
  let dataSources: VendorAnalysisDataSource[]
  if (body.dataSources !== undefined) {
    if (!Array.isArray(body.dataSources) || body.dataSources.some((s) => typeof s !== 'string') || body.dataSources.length === 0) {
      res.status(400).json({ ok: false, error: '无效的 dataSources' })
      return
    }
    const parsed = parseVendorAnalysisDataSources(body.dataSources as string[])
    if (parsed.invalid.length > 0) {
      res.status(400).json({ ok: false, error: `未知数据源: ${parsed.invalid.join(', ')}` })
      return
    }
    dataSources = parsed.dataSources
  } else {
    const resolved = resolveVendorAnalysisDataSources(metricKeys)
    if (resolved.unknownKeys.length > 0) {
      res.status(400).json({ ok: false, error: `未知指标: ${resolved.unknownKeys.join(', ')}` })
      return
    }
    dataSources = resolved.dataSources
  }

  // vendorCodes 由服务端直接查统一供应商配置表得出；按分析目标州过滤，与车队配置的按州隔离保持一致
  // （超管未指定具体州时 regionResult 为 null，此时不限州，覆盖全部供应商配置）
  const db = getDb()
  const configRows = await listSupplierPushConfigs(regionResult ?? undefined)
  const vendorCodes = [...new Set(configRows.map((c) => normalizeVendorAnalyzeCode(c.vendorCode)).filter(Boolean))]

  // 路由码白名单：命中的路由码代表要从该供应商统计中剔除的数据，随任务 payload 冻结
  const routeCodeWhitelistByVendor: Record<string, string[]> = {}
  for (const c of configRows) {
    const codes = parseRouteCodes(c.routeCodeWhitelist)
    if (codes.length > 0) routeCodeWhitelistByVendor[normalizeVendorAnalyzeCode(c.vendorCode)] = codes
  }

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
        dataSources,
        routeCodeWhitelistByVendor,
      })

  const enqueuePayload = {
    imileToken: token,
    stationCodes,
    vendorCodes,
    routeCodeWhitelistByVendor,
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
    dataSources,
    // 仅用于任务队列「查看数据」还原当时的指标勾选状态，Worker 抓取阶段不读此字段
    metricKeys,
    // 输出配置：推送供应商范围 + AI 开关。Worker 不读，仅落库供「查看数据」时应用、以及「编辑」时修改
    pushEnabledIds: Array.isArray(body.pushEnabledIds)
      ? (body.pushEnabledIds as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    aiSummaryEnabled: body.aiSummaryEnabled !== false,
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

// 编辑任务的「输出配置」：仅推送供应商范围 + AI 分析总结开关。这两项不参与分析、不影响结果与幂等，
// 因此任务创建后可自由修改（浅合并进 payload），不需要重跑 worker。
vendorAnalysisRouter.patch('/analyze-jobs/:jobId/config', async (req: AuthenticatedRequest, res: Response) => {
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

  const body = req.body as { pushEnabledIds?: unknown; aiSummaryEnabled?: unknown }
  const patch: Record<string, unknown> = {}
  if (body.pushEnabledIds !== undefined) {
    if (!Array.isArray(body.pushEnabledIds) || body.pushEnabledIds.some((s) => typeof s !== 'string')) {
      res.status(400).json({ ok: false, error: '无效的 pushEnabledIds' })
      return
    }
    patch.pushEnabledIds = body.pushEnabledIds
  }
  if (body.aiSummaryEnabled !== undefined) {
    if (typeof body.aiSummaryEnabled !== 'boolean') {
      res.status(400).json({ ok: false, error: '无效的 aiSummaryEnabled' })
      return
    }
    patch.aiSummaryEnabled = body.aiSummaryEnabled
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ ok: false, error: '无可更新字段' })
    return
  }

  const updated = await updateJobPayload(jobId, patch)
  if (!updated) {
    res.status(404).json({ ok: false, error: '任务不存在' })
    return
  }
  res.json({ ok: true })
})

// ─── 日报发布（供外部分享链接读取） ────────────────────────────────────────────

type DailyReportBody = {
  /** 该日报对应的分析任务；日报与分享链接按它绑定（每任务一份，互不覆盖） */
  jobId?: unknown
  reportDate?: unknown
  stations?: unknown
  complaintDateRange?: unknown
  before11Date?: unknown
  dispatch24hDate?: unknown
  generatedAt?: unknown
  vendors?: unknown
  aiSummaries?: unknown
  enabledMetricKeys?: unknown
}

/**
 * 保存 openSnapshot 生成的日报快照（VendorSnapshotData 去掉 webhookConfigs）。
 * 只透传白名单字段入库，webhook 地址与签名密钥永不落到该表。
 */
vendorAnalysisRouter.post('/daily-reports', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as DailyReportBody
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : ''
  if (!jobId) {
    res.status(400).json({ ok: false, error: '缺少 jobId' })
    return
  }
  if (typeof body.reportDate !== 'string' || !body.reportDate.trim()) {
    res.status(400).json({ ok: false, error: '缺少 reportDate' })
    return
  }
  if (!Array.isArray(body.vendors) || body.vendors.length === 0) {
    res.status(400).json({ ok: false, error: '缺少 vendors 数据' })
    return
  }
  // 校验任务存在且当前用户可访问，避免给别人的任务发布日报
  const job = await getJobById(jobId)
  if (!job || !canAccessJob(req, job)) {
    sendJobAccessDenied(res)
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
    // 发布时的指标勾选集合；外部门户按它过滤渲染，缺省（老日报）视为全量
    enabledMetricKeys:
      Array.isArray(body.enabledMetricKeys) && body.enabledMetricKeys.every((k) => typeof k === 'string')
        ? (body.enabledMetricKeys as string[])
        : undefined,
  }
  try {
    const db = getDb()
    const [row] = await db
      .insert(schema.vendorDailyReports)
      .values({
        jobId,
        reportDate: payload.reportDate,
        payload,
        createdBy: req.authUser?.id ?? null,
      })
      .onConflictDoUpdate({
        target: schema.vendorDailyReports.jobId,
        set: { payload, reportDate: payload.reportDate, createdBy: req.authUser?.id ?? null, createdAt: new Date() },
      })
      .returning({ id: schema.vendorDailyReports.id, createdAt: schema.vendorDailyReports.createdAt })

    // 按 (vendorCode, jobId) 自动开通分享链接：已存在则跳过，不轮换 token（同一任务重复发布不能让已发给供应商的链接失效）
    try {
      for (const vendor of payload.vendors as Array<{ vendorCode?: unknown; vendorName?: unknown }>) {
        const vendorCode = typeof vendor.vendorCode === 'string' ? vendor.vendorCode.trim() : ''
        const vendorName = typeof vendor.vendorName === 'string' ? vendor.vendorName.trim() : ''
        if (!vendorCode) continue
        await db
          .insert(schema.vendorShareLinks)
          .values({
            jobId,
            vendorCode,
            vendorName,
            reportDate: payload.reportDate,
            token: generateShareToken(),
            createdBy: req.authUser?.id ?? null,
          })
          .onConflictDoNothing({
            target: [schema.vendorShareLinks.vendorCode, schema.vendorShareLinks.jobId],
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
  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId.trim() : ''
  if (!jobId) {
    res.status(400).json({ ok: false, error: '缺少 jobId' })
    return
  }
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.vendorShareLinks)
      .where(eq(schema.vendorShareLinks.jobId, jobId))
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
  /** 以下字段均对应可自由取消的指标，未勾选对应指标时省略 */
  ofdCount?: number
  /** 24H派签率，fraction */
  dispatchRate24h?: number | null
  dispatch24hCount?: number
  totalDispatchCount?: number
  returnWarningCount?: number
  longTailCount?: number
}

type VendorAiInput = {
  vendorCode: string
  vendorName: string
  /** 以下字段均对应可自由取消的指标，未勾选对应指标时省略 */
  before11ExitRate?: number | null
  dispatchRate24h?: number | null
  complaintRate?: number
  complaintCount?: number
  waybillCount?: number
  unprocessedTicketCount?: number
  longTailCount?: number
  /** 按归班预警数降序、再按派签率升序排列，最多 30 条 */
  drivers: VendorAiDriverInput[]
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

  const { vendors, locale: rawLocale, metricKeys: rawMetricKeys } = req.body as {
    vendors?: VendorAiInput[]
    locale?: unknown
    metricKeys?: unknown
  }
  if (!Array.isArray(vendors) || vendors.length === 0) {
    res.status(400).json({ ok: false, error: '缺少 vendors 数据' })
    return
  }

  // 不传 metricKeys（老客户端）→ prompt 与历史硬编码版本一致
  const metricKeys =
    Array.isArray(rawMetricKeys) && rawMetricKeys.every((k) => typeof k === 'string')
      ? (rawMetricKeys as string[])
      : null

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
        { role: 'system', content: buildVendorAiSystemPrompt(locale, metricKeys) },
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
