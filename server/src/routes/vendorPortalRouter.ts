import { Router, type Request, type Response, type NextFunction } from 'express'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import {
  dispatchRateFromTotals,
  rankVendors,
  type VendorRankingInput,
  type VendorRankingResult,
} from '../../../shared/vendorAnalysis/rankingScore'
import { queryDriverMapPoints, geocodePendingMapPoints, ensureProblemReasons } from '../driverMap/driverMapPointsQuery'
import { listSupplierPushConfigs } from '../supplierPushConfigs'

/**
 * 供应商日报外部门户（无登录鉴权，仅凭高熵分享 token 访问）。
 * 安全约束：
 * - 数据切片在服务端完成，响应为显式白名单构造，绝不透传完整日报 payload
 * - 链接不存在 / 已禁用 / 无日报 / 供应商不在最新日报中，统一返回同一 404，防止枚举
 * - token 不写入任何日志
 */
export const vendorPortalRouter = Router()

const SHARE_TOKEN_PATTERN = /^[0-9a-f]{64}$/

/** 分享链接有效期：一周（与 retention 保留期一致） */
const SHARE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

// ─── 极简内存限流：60 次/分钟/IP（代码库无现成 rate-limit 中间件） ──────────────
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60_000
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now()
  const ip = req.ip ?? 'unknown'
  const bucket = rateBuckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    // 顺带清理过期桶，避免 Map 无限增长
    if (rateBuckets.size > 10_000) {
      for (const [key, value] of rateBuckets) {
        if (value.resetAt <= now) rateBuckets.delete(key)
      }
    }
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    next()
    return
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) {
    res.status(429).json({ ok: false, error: 'Too many requests' })
    return
  }
  next()
}

function sendNotFound(res: Response): void {
  res.status(404).json({ ok: false, error: 'not_found' })
}

// ─── 日报 payload 中与本路由相关的最小类型（与前端 vendorSnapshotStorage.ts 的 VendorSnapshotData 对应） ───

type ReportDriver = {
  courierCode?: unknown
  courierName?: unknown
  routeCode?: unknown
  ofdCount?: unknown
  ofdWaybillNos?: unknown
  before11OfdCount?: unknown
  before11UnmetWaybillNos?: unknown
  returnWarningCount?: unknown
  returnWarningWaybillNos?: unknown
  dispatch24hCount?: unknown
  totalDispatchCount?: unknown
  dispatchRate24h?: unknown
  dispatch24hUnmetWaybillNos?: unknown
  longTailCount?: unknown
  longTailWaybillNos?: unknown
}

type ReportVendor = {
  vendorCode?: unknown
  vendorName?: unknown
  complaintRate?: unknown
  complaintCount?: unknown
  waybillCount?: unknown
  before11ExitRate?: unknown
  before11ExitVolume?: unknown
  before11TotalReceived?: unknown
  dispatchRate24hText?: unknown
  notMet24hSignCount?: unknown
  dispatch24hTotal?: unknown
  dispatch24hCount?: unknown
  unprocessedTicketCount?: unknown
  longTailCount?: unknown
  drivers?: unknown
}

type ReportPayload = {
  reportDate?: unknown
  stations?: unknown
  complaintDateRange?: unknown
  before11Date?: unknown
  dispatch24hDate?: unknown
  generatedAt?: unknown
  vendors?: unknown
  aiSummaries?: Record<string, unknown>
  enabledMetricKeys?: unknown
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** 显式白名单构造司机行，防止 payload 中的多余字段泄漏 */
function pickDriver(raw: ReportDriver) {
  return {
    courierCode: str(raw.courierCode),
    courierName: str(raw.courierName),
    routeCode: str(raw.routeCode),
    ofdCount: num(raw.ofdCount),
    ofdWaybillNos: strArr(raw.ofdWaybillNos),
    before11OfdCount: num(raw.before11OfdCount),
    before11UnmetWaybillNos: strArr(raw.before11UnmetWaybillNos),
    returnWarningCount: num(raw.returnWarningCount),
    returnWarningWaybillNos: strArr(raw.returnWarningWaybillNos),
    dispatch24hCount: num(raw.dispatch24hCount),
    totalDispatchCount: num(raw.totalDispatchCount),
    dispatchRate24h: numOrNull(raw.dispatchRate24h),
    dispatch24hUnmetWaybillNos: strArr(raw.dispatch24hUnmetWaybillNos),
    longTailCount: num(raw.longTailCount),
    longTailWaybillNos: strArr(raw.longTailWaybillNos),
  }
}

/** 显式白名单构造供应商切片 */
function pickVendor(raw: ReportVendor) {
  const drivers = Array.isArray(raw.drivers) ? (raw.drivers as ReportDriver[]).map(pickDriver) : []
  return {
    vendorCode: str(raw.vendorCode),
    vendorName: str(raw.vendorName),
    complaintRate: num(raw.complaintRate),
    complaintCount: num(raw.complaintCount),
    waybillCount: num(raw.waybillCount),
    before11ExitRate: numOrNull(raw.before11ExitRate),
    before11ExitVolume: numOrNull(raw.before11ExitVolume),
    before11TotalReceived: numOrNull(raw.before11TotalReceived),
    dispatchRate24hText: strOrNull(raw.dispatchRate24hText),
    notMet24hSignCount: numOrNull(raw.notMet24hSignCount),
    dispatch24hTotal: numOrNull(raw.dispatch24hTotal),
    dispatch24hCount: numOrNull(raw.dispatch24hCount),
    unprocessedTicketCount: num(raw.unprocessedTicketCount),
    longTailCount: num(raw.longTailCount),
    isDisabled: false,
    drivers,
  }
}

function toRankingInput(raw: ReportVendor): VendorRankingInput {
  const dispatch24hTotal = numOrNull(raw.dispatch24hTotal)
  const dispatch24hCount = numOrNull(raw.dispatch24hCount)
  return {
    vendorCode: str(raw.vendorCode),
    complaintRate: num(raw.complaintRate),
    complaintCount: num(raw.complaintCount),
    waybillCount: num(raw.waybillCount),
    unprocessedTicketCount: num(raw.unprocessedTicketCount),
    longTailCount: num(raw.longTailCount),
    before11ExitRate: numOrNull(raw.before11ExitRate),
    before11ExitVolume: numOrNull(raw.before11ExitVolume),
    before11TotalReceived: numOrNull(raw.before11TotalReceived),
    dispatchRate24h: dispatchRateFromTotals(dispatch24hCount, dispatch24hTotal),
    dispatch24hTotal,
    dispatch24hCount,
  }
}

function pickAiSummary(raw: unknown): Partial<Record<'zh-CN' | 'en', string>> | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const out: Partial<Record<'zh-CN' | 'en', string>> = {}
  for (const locale of ['zh-CN', 'en'] as const) {
    const text = entry[locale]
    if (typeof text === 'string' && text.trim()) out[locale] = text
  }
  return Object.keys(out).length ? out : null
}

vendorPortalRouter.get('/daily/:token', rateLimit, async (req: Request, res: Response) => {
  const token = String(req.params.token ?? '')
  if (!SHARE_TOKEN_PATTERN.test(token)) {
    sendNotFound(res)
    return
  }

  try {
    const db = getDb()
    const [link] = await db
      .select()
      .from(schema.vendorShareLinks)
      .where(eq(schema.vendorShareLinks.token, token))
      .limit(1)
    if (!link || link.isDisabled) {
      sendNotFound(res)
      return
    }

    // 一周有效期：超过 7 天（按开通时刻）即失效，与后端保留期一致，防止过期链接仍可访问
    if (Date.now() - new Date(link.createdAt).getTime() > SHARE_LINK_TTL_MS) {
      sendNotFound(res)
      return
    }

    const [report] = await db
      .select({ payload: schema.vendorDailyReports.payload })
      .from(schema.vendorDailyReports)
      .where(eq(schema.vendorDailyReports.jobId, link.jobId))
      .limit(1)
    if (!report) {
      sendNotFound(res)
      return
    }

    const payload = report.payload as ReportPayload
    const vendors = Array.isArray(payload.vendors) ? (payload.vendors as ReportVendor[]) : []
    const linkCode = str(link.vendorCode)
    const vendorRaw = vendors.find((v) => str(v.vendorCode) === linkCode)
    if (!vendorRaw) {
      sendNotFound(res)
      return
    }

    const enabledMetricKeys = Array.isArray(payload.enabledMetricKeys)
      ? strArr(payload.enabledMetricKeys)
      : null
    const enabledSet = enabledMetricKeys ? new Set(enabledMetricKeys) : undefined
    // 与快照页同一套 rankVendors：用日报里全部供应商做池，再取当前供应商名次
    const rankingPool = rankVendors(
      vendors
        .filter((v) => str(v.vendorCode))
        .map(toRankingInput),
      enabledSet,
    )
    const ranking: VendorRankingResult | null =
      rankingPool.byVendorCode.get(str(vendorRaw.vendorCode)) ?? null

    // 访问时间异步更新，不阻塞响应，失败不影响本次请求
    void db
      .update(schema.vendorShareLinks)
      .set({ lastAccessedAt: new Date() })
      .where(eq(schema.vendorShareLinks.id, link.id))
      .catch(() => {})

    res.json({
      ok: true,
      data: {
        reportDate: str(payload.reportDate),
        complaintDateRange: str(payload.complaintDateRange),
        before11Date: str(payload.before11Date),
        dispatch24hDate: str(payload.dispatch24hDate),
        generatedAt: str(payload.generatedAt),
        vendor: pickVendor(vendorRaw),
        ranking,
        aiSummary: pickAiSummary(payload.aiSummaries?.[linkCode] ?? payload.aiSummaries?.[str(vendorRaw.vendorCode)]),
        enabledMetricKeys,
      },
    })
  } catch {
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

/**
 * 司机地图（分享链接门户）：每个供应商 token 各自一份地图（按 vendorCode 过滤）。
 * 站点取日报 stations[0]（与内部快照一致），缺省再回退车队配置 stationCode。
 * 有地址无坐标时按本供应商 geocode 补点；未勾选 module.driverMap 时 data: null。
 */
vendorPortalRouter.get('/driver-map/:token', rateLimit, async (req: Request, res: Response) => {
  const token = String(req.params.token ?? '')
  if (!SHARE_TOKEN_PATTERN.test(token)) {
    sendNotFound(res)
    return
  }

  try {
    const db = getDb()
    const [link] = await db
      .select()
      .from(schema.vendorShareLinks)
      .where(eq(schema.vendorShareLinks.token, token))
      .limit(1)
    if (!link || link.isDisabled) {
      sendNotFound(res)
      return
    }
    if (Date.now() - new Date(link.createdAt).getTime() > SHARE_LINK_TTL_MS) {
      sendNotFound(res)
      return
    }

    const [report] = await db
      .select({ payload: schema.vendorDailyReports.payload })
      .from(schema.vendorDailyReports)
      .where(eq(schema.vendorDailyReports.jobId, link.jobId))
      .limit(1)
    if (!report) {
      sendNotFound(res)
      return
    }

    const payload = report.payload as ReportPayload
    const enabledMetricKeys = strArr(payload.enabledMetricKeys)
    if (!enabledMetricKeys.includes('module.driverMap')) {
      res.json({ ok: true, data: null })
      return
    }

    const vendorCode = str(link.vendorCode)
    if (!vendorCode) {
      res.json({ ok: true, data: null })
      return
    }

    const stations = strArr(payload.stations)
    let stationCode = stations[0]?.trim() ?? ''
    if (!stationCode) {
      const configs = await listSupplierPushConfigs()
      const vendorConfig = configs.find((c) => c.vendorCode.trim() === vendorCode)
      stationCode = vendorConfig?.stationCode.trim() ?? ''
    }
    if (!stationCode) {
      res.json({ ok: true, data: null })
      return
    }

    // 司机地图看「昨天」签收情况，与 11 点前出仓率同一日；不是 24H 派签的前天
    const dataDate = str(payload.before11Date) || str(payload.reportDate)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
      res.json({ ok: true, data: null })
      return
    }

    // 有地址无坐标时：按本供应商范围把 consignee 地址 geocode 成 lat/lng（有时间预算，可多次打开继续补）
    await ensureProblemReasons({ stationCode, dataDate, vendorCode })
    await geocodePendingMapPoints({ stationCode, dataDate, vendorCode })

    const points = await queryDriverMapPoints({
      stationCode,
      dataDate,
      vendorCode,
    })
    if (!points.ok) {
      res.status(502).json({ ok: false, error: points.message })
      return
    }

    res.json({ ok: true, data: points.data })
  } catch (err) {
    console.error('[vendor-portal/driver-map]', err)
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})
