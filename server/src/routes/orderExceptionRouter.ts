import { Router, type Request, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { runOrderAnalyzePipeline } from '../orderAnalyze/pipeline'
import { reclassifyOutWarehouseLossWithCancelScan } from '../orderAnalyze/cancelScanReclassify'
import { enrichTheftSuspectDriverVendor } from '../orderAnalyze/driverVendorEnrich'
import { applyLossTimeoutDaysOverride, parseWarehouseConfigInput } from '../orderAnalyze/warehouseProfiles'
import type { AnalyzeTarget } from '../openaiOrderAnalyze'
import {
  addClosureException,
  queryClosureVendorOptions,
  queryDriverVendorByDriverId,
  readClosureDefaultStationCode,
} from '../imile/closure'
import {
  fetchOrderExceptionSourcesForAnalyze,
  prefetchOrderExceptionData,
  queryTracksWithCache,
} from './orderExceptionData'
import { computeInHubStockRange, fetchInHubWaybillInventory } from '../imile/inHubWaybillInventory'
import { registerOrderExceptionRegressionRoutes } from './orderExceptionRegressionRouter'
import { readImileTokenFromRequest } from './imileAuth'
import { getDb } from '../db'
import { orderExceptionPostFilterConfigs, orderExceptionWarehouseConfigs } from '../db/schema'
import { DEFAULT_WAREHOUSE_CONFIG } from '../orderAnalyze/warehouseProfiles'
import { requirePermission, type AuthenticatedRequest } from '../auth/middleware'
import { enqueueJob } from '../jobs/queue'
import { ORDER_ANALYZE_JOB_TYPE } from '../jobs/handlers'

export const orderExceptionRouter = Router()

function readJson<T>(req: Request): T {
  return req.body as T
}

function readImileToken(req: Request, bodyToken: unknown): string {
  return readImileTokenFromRequest(req, bodyToken, { allowQuery: true })
}

function readOptionalPositiveInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || n < 1) return undefined
  return Math.floor(n)
}

registerOrderExceptionRegressionRoutes(orderExceptionRouter, {
  readJson,
  readImileToken,
  queryTracksWithCache,
})

orderExceptionRouter.get('/closure/vendors', async (req: Request, res: Response) => {
  try {
    const token = readImileToken(req, undefined)
    if (!token) {
      res.status(400).json({ error: '缺少 imileToken' })
      return
    }

    const result = await queryClosureVendorOptions(token)
    if (!result.ok) {
      res.status(502).json({
        error: result.message,
        status: result.status,
        rawText: result.rawText,
      })
      return
    }

    res.json({
      vendors: result.vendors,
      defaultStationCode: readClosureDefaultStationCode(),
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '供应商列表查询失败' })
  }
})

orderExceptionRouter.post('/closure/driver-vendor', async (req: Request, res: Response) => {
  try {
    const body = readJson<{ imileToken?: string; driverId?: string; stationCode?: string }>(req)
    const token = readImileToken(req, body.imileToken)
    const driverId = String(body.driverId ?? '').trim()
    const stationCode = String(body.stationCode ?? '').trim() || readClosureDefaultStationCode()
    if (!token) {
      res.status(400).json({ error: '缺少 imileToken' })
      return
    }
    if (!driverId) {
      res.status(400).json({ error: '缺少 driverId' })
      return
    }

    const result = await queryDriverVendorByDriverId({
      imileToken: token,
      driverId,
      stationCode,
    })
    if (!result.ok) {
      res.status(502).json({
        error: result.message,
        status: result.status,
        rawText: result.rawText,
      })
      return
    }

    res.json({
      stationCode,
      result: result.result,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '司机供应商查询失败' })
  }
})

orderExceptionRouter.post(
  '/closure/add',
  requirePermission('btn:order-exception:closure-add'),
  async (req: Request, res: Response) => {
    try {
      const body = readJson<{
        imileToken?: string
        waybillNo?: string
        exceptionCloseReason?: string
        exceptionHandleRemark?: string
        vendorCode?: string
        violence?: string
      }>(req)
      const token = readImileToken(req, body.imileToken)
      const waybillNo = String(body.waybillNo ?? '').trim()
      const exceptionCloseReason = String(body.exceptionCloseReason ?? '').trim()
      const exceptionHandleRemark = String(body.exceptionHandleRemark ?? '').trim()
      const vendorCode = String(body.vendorCode ?? '').trim()
      const violence = body.violence === '1' ? '1' : '0'

      if (!token) {
        res.status(400).json({ error: '缺少 imileToken' })
        return
      }
      if (!waybillNo) {
        res.status(400).json({ error: '缺少运单号' })
        return
      }
      if (!exceptionCloseReason) {
        res.status(400).json({ error: '缺少异常类型' })
        return
      }
      if (exceptionCloseReason === 'aus_packet_loss_out_the_station' && !vendorCode) {
        res.status(400).json({ error: '库外丢包必须选择派件员供应商' })
        return
      }

      const result = await addClosureException({
        imileToken: token,
        waybillNo,
        exceptionCloseReason,
        exceptionHandleRemark,
        vendorCode,
        violence,
      })
      if (!result.ok) {
        res.status(502).json({
          error: result.message,
          status: result.status,
          rawText: result.rawText,
        })
        return
      }

      res.json({ ok: true })
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || '异常完结新增失败' })
    }
  }
)

orderExceptionRouter.post('/track', async (req: Request, res: Response) => {
  try {
    const body = readJson<{ imileToken?: string; orderNos?: string[] }>(req)
    const token = readImileToken(req, body.imileToken)
    const orderNos = Array.isArray(body.orderNos)
      ? body.orderNos.map((s) => String(s).trim()).filter(Boolean)
      : []
    if (!token) {
      res.status(400).json({ error: '缺少 imileToken' })
      return
    }
    if (!orderNos.length) {
      res.status(400).json({ error: '请提供 orderNos' })
      return
    }
    if (orderNos.length > 500) {
      res.status(400).json({ error: '单次最多查询 500 个订单号' })
      return
    }

    const result = await queryTracksWithCache(token, orderNos)
    if (!result.ok) {
      res.status(502).json({
        error: result.message,
        status: result.status,
        rawText: result.rawText,
      })
      return
    }

    res.json({
      trackInfo: result.trackInfo,
      orderInfo: result.orderInfo,
      raw: result.raw,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '轨迹查询失败' })
  }
})

/** 并行预取轨迹+阻断并写入缓存，不调用 AI。 */
orderExceptionRouter.post('/prefetch', async (req: Request, res: Response) => {
  try {
    const body = readJson<{ imileToken?: string; orderNos?: string[] }>(req)
    const token = readImileToken(req, body.imileToken)
    const orderNos = Array.isArray(body.orderNos)
      ? body.orderNos.map((s) => String(s).trim()).filter(Boolean)
      : []
    if (!token) {
      res.status(400).json({ error: '缺少 imileToken' })
      return
    }
    if (!orderNos.length) {
      res.status(400).json({ error: '请提供 orderNos' })
      return
    }
    if (orderNos.length > 500) {
      res.status(400).json({ error: '单次最多预取 500 个订单号' })
      return
    }

    const result = await prefetchOrderExceptionData(token, orderNos)
    if (!result.ok) {
      res.status(502).json({
        error: result.message,
        status: result.status,
        rawText: result.rawText,
      })
      return
    }

    res.json({
      trackInfo: result.trackInfo,
      orderInfo: result.orderInfo,
      interceptLogs: result.interceptLogs,
      meta: result.meta,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '预取失败' })
  }
})

/** 按库内滞留天数区间查询在库运单号（inHubWaybillInbentory），供「库内异常订单分析」Tab 取号源。 */
orderExceptionRouter.post('/in-hub-waybills', async (req: Request, res: Response) => {
  try {
    const body = readJson<{
      imileToken?: string
      stationCode?: string
      greaterDays?: number
      lessDays?: number
    }>(req)
    const token = readImileToken(req, body.imileToken)
    const stationCode = String(body.stationCode ?? '').trim()
    const greaterDays = Number(body.greaterDays)
    const lessDays = Number(body.lessDays)

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken' })
      return
    }
    if (!stationCode) {
      res.status(400).json({ error: '缺少责任站点编码' })
      return
    }
    if (!Number.isFinite(greaterDays) || !Number.isFinite(lessDays) || greaterDays < 0 || lessDays < 0) {
      res.status(400).json({ error: '请提供合法的天数区间' })
      return
    }
    if (lessDays <= greaterDays) {
      res.status(400).json({ error: '"小于"天数须大于"大于"天数' })
      return
    }

    const todayStr = new Date().toISOString().slice(0, 10)
    const { start, end } = computeInHubStockRange(todayStr, greaterDays, lessDays)

    const result = await fetchInHubWaybillInventory(token, { stationCode, start, end })
    if (!result.ok) {
      res.status(502).json({
        error: result.message,
        status: result.status,
        rawText: result.rawText,
      })
      return
    }

    res.json({
      waybillNos: result.data,
      start,
      end,
      totalResult: result.data.length,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '库内异常订单查询失败' })
  }
})

orderExceptionRouter.get('/post-filter', async (_req: Request, res: Response) => {
  try {
    const db = getDb()
    const [row] = await db
      .select()
      .from(orderExceptionPostFilterConfigs)
      .where(eq(orderExceptionPostFilterConfigs.configKey, 'global'))
      .limit(1)
    res.json({ config: row?.payload ?? null })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '读取后置过滤配置失败' })
  }
})

orderExceptionRouter.post('/post-filter', async (req: Request, res: Response) => {
  try {
    const { payload } = req.body as { payload: unknown }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      res.status(400).json({ error: '无效的过滤配置' })
      return
    }
    const now = new Date()
    const authReq = req as AuthenticatedRequest
    const db = getDb()
    const [result] = await db
      .insert(orderExceptionPostFilterConfigs)
      .values({
        configKey: 'global',
        payload,
        savedBy: authReq.authUser?.id ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: orderExceptionPostFilterConfigs.configKey,
        set: {
          payload,
          savedBy: authReq.authUser?.id ?? null,
          updatedAt: now,
        },
      })
      .returning()
    res.json({ config: result.payload, updatedAt: result.updatedAt.toISOString() })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '保存后置过滤配置失败' })
  }
})

orderExceptionRouter.get('/warehouse-config', async (_req: Request, res: Response) => {
  try {
    const db = getDb()
    const [row] = await db
      .select()
      .from(orderExceptionWarehouseConfigs)
      .where(eq(orderExceptionWarehouseConfigs.configKey, 'global'))
      .limit(1)
    res.json({ config: row?.payload ?? DEFAULT_WAREHOUSE_CONFIG })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '读取仓库配置失败' })
  }
})

orderExceptionRouter.post(
  '/warehouse-config',
  requirePermission('btn:order-exception:config-edit'),
  async (req: Request, res: Response) => {
    try {
      const { payload } = req.body as { payload: unknown }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        res.status(400).json({ error: '无效的仓库配置' })
        return
      }
      const now = new Date()
      const authReq = req as AuthenticatedRequest
      const db = getDb()
      const [result] = await db
        .insert(orderExceptionWarehouseConfigs)
        .values({
          configKey: 'global',
          payload,
          savedBy: authReq.authUser?.id ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: orderExceptionWarehouseConfigs.configKey,
          set: {
            payload,
            savedBy: authReq.authUser?.id ?? null,
            updatedAt: now,
          },
        })
        .returning()
      res.json({ config: result.payload, updatedAt: result.updatedAt.toISOString() })
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || '保存仓库配置失败' })
    }
  }
)

orderExceptionRouter.post('/analyze', async (req: Request, res: Response) => {
  try {
    const body = readJson<{
      imileToken?: string
      orderNos?: string[]
      aiProvider?: string
      enableAiExplain?: boolean
      scanStationCode?: string
      lossTimeoutDays?: unknown
    }>(req)
    const token = readImileToken(req, body.imileToken)
    const orderNos = Array.isArray(body.orderNos)
      ? body.orderNos.map((s) => String(s).trim()).filter(Boolean)
      : []
    if (!token) {
      res.status(400).json({ error: '缺少 imileToken' })
      return
    }
    if (!orderNos.length) {
      res.status(400).json({ error: '请提供 orderNos' })
      return
    }
    if (orderNos.length > 500) {
      res.status(400).json({ error: '单次最多分析 500 个订单，请拆分后分批提交' })
      return
    }

    const db = getDb()
    const [warehouseConfigRow] = await db
      .select()
      .from(orderExceptionWarehouseConfigs)
      .where(eq(orderExceptionWarehouseConfigs.configKey, 'global'))
      .limit(1)
    const warehouseConfigPayload = warehouseConfigRow?.payload ?? DEFAULT_WAREHOUSE_CONFIG

    const imileStartedAt = performance.now()
    const sourceResult = await fetchOrderExceptionSourcesForAnalyze(token, orderNos)
    const imileMs = Math.round(performance.now() - imileStartedAt)
    if (!sourceResult.ok) {
      res.status(502).json({
        error: sourceResult.message,
        status: sourceResult.status,
        rawText: sourceResult.rawText,
      })
      return
    }

    const targets: AnalyzeTarget[] = orderNos.map((no) => ({
      orderNo: no,
      tracks: sourceResult.trackInfo[no] ?? [],
      interceptLogs: sourceResult.interceptLogs[no] ?? [],
    }))

    const aiProviderRaw = String(body.aiProvider ?? 'deepseek').trim().toLowerCase()
    const aiProvider = aiProviderRaw === 'openai' ? 'openai' : 'deepseek'
    const enableAiExplain = body.enableAiExplain === true

    const aiStartedAt = performance.now()
    const parsedWarehouseConfig = parseWarehouseConfigInput(warehouseConfigPayload)
    const lossTimeoutOverride = readOptionalPositiveInt(body.lossTimeoutDays)
    if (body.lossTimeoutDays != null && body.lossTimeoutDays !== '' && lossTimeoutOverride == null) {
      res.status(400).json({ error: 'lossTimeoutDays 须为 ≥ 1 的整数' })
      return
    }
    const warehouseConfig =
      lossTimeoutOverride != null
        ? applyLossTimeoutDaysOverride(parsedWarehouseConfig ?? DEFAULT_WAREHOUSE_CONFIG, lossTimeoutOverride)
        : parsedWarehouseConfig
    const { results: pipelineResults, tokenUsage, trackFacts } = await runOrderAnalyzePipeline({
      targets,
      aiProvider,
      enableAiExplain,
      warehouseConfig,
    })
    const aiMs = Math.round(performance.now() - aiStartedAt)

    const { results: recheckedResults, meta: cancelScanRecheck } =
      await reclassifyOutWarehouseLossWithCancelScan({
        results: pipelineResults,
        trackFacts,
        imileToken: token,
        scanStationCode: body.scanStationCode,
      })

    const { results, meta: driverVendorEnrich } = await enrichTheftSuspectDriverVendor({
      results: recheckedResults,
      trackFacts,
      imileToken: token,
      scanStationCode: body.scanStationCode,
    })

    res.json({
      results,
      trackInfo: sourceResult.trackInfo,
      orderInfo: sourceResult.orderInfo,
      interceptLogs: sourceResult.interceptLogs,
      tokenUsage,
      timing: { imileMs, aiMs },
      trackFacts,
      cancelScanRecheck,
      driverVendorEnrich,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '分析失败' })
  }
})

/** 异步版本：立即返回 jobId，由 worker 后台执行；前端轮询 /api/jobs/:id 获取结果 */
orderExceptionRouter.post('/analyze-async', async (req: Request, res: Response) => {
  try {
    const body = readJson<{
      imileToken?: string
      orderNos?: string[]
      aiProvider?: string
      enableAiExplain?: boolean
      scanStationCode?: string
    }>(req)
    const token = readImileToken(req, body.imileToken)
    const orderNos = Array.isArray(body.orderNos)
      ? body.orderNos.map((s) => String(s).trim()).filter(Boolean)
      : []
    if (!token) {
      res.status(400).json({ error: '缺少 imileToken' })
      return
    }
    if (!orderNos.length) {
      res.status(400).json({ error: '请提供 orderNos' })
      return
    }
    if (orderNos.length > 500) {
      res.status(400).json({ error: '单次最多分析 500 个订单，请拆分后分批提交' })
      return
    }

    const aiProvider = String(body.aiProvider ?? 'deepseek').trim().toLowerCase() === 'openai' ? 'openai' : 'deepseek'
    const enableAiExplain = body.enableAiExplain === true
    const scanStationCode = String(body.scanStationCode ?? '').trim() || undefined
    const authReq = req as AuthenticatedRequest

    const job = await enqueueJob({
      type: ORDER_ANALYZE_JOB_TYPE,
      payload: { imileToken: token, orderNos, aiProvider, enableAiExplain, scanStationCode },
      regionCode: authReq.authUser?.regionCode ?? null,
      createdBy: authReq.authUser?.id ?? null,
      maxAttempts: 2,
    })

    res.status(202).json({ jobId: job.id, status: job.status, orderCount: orderNos.length })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '提交分析任务失败' })
  }
})
