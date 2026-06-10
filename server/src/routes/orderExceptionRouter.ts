import { Router, type Request, type Response } from 'express'
import { runOrderAnalyzePipeline } from '../orderAnalyze/pipeline'
import type { AnalyzeTarget } from '../openaiOrderAnalyze'
import {
  queryClosureVendorOptions,
  queryDriverVendorByDriverId,
  readClosureDefaultStationCode,
} from '../imile/closure'
import {
  fetchOrderExceptionSourcesForAnalyze,
  prefetchOrderExceptionData,
  queryTracksWithCache,
} from './orderExceptionData'
import { registerOrderExceptionRegressionRoutes } from './orderExceptionRegressionRouter'

export const orderExceptionRouter = Router()

function readJson<T>(req: Request): T {
  return req.body as T
}

function normalizeToken(raw: string): string {
  return raw.replace(/^Bearer\s+/i, '').trim()
}

function readImileToken(req: Request, bodyToken: unknown): string {
  const fromBody = String(bodyToken ?? '').trim()
  if (fromBody) return normalizeToken(fromBody)

  const fromQuery = String(req.query?.token ?? '').trim()
  if (fromQuery) return normalizeToken(fromQuery)

  const authHeader = String(req.headers.authorization ?? '').trim()
  if (authHeader) return normalizeToken(authHeader)

  return ''
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

orderExceptionRouter.post('/analyze', async (req: Request, res: Response) => {
  try {
    const body = readJson<{
      imileToken?: string
      orderNos?: string[]
      aiProvider?: string
      enableAiExplain?: boolean
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
    const { results, tokenUsage } = await runOrderAnalyzePipeline({ targets, aiProvider, enableAiExplain })
    const aiMs = Math.round(performance.now() - aiStartedAt)

    res.json({
      results,
      trackInfo: sourceResult.trackInfo,
      orderInfo: sourceResult.orderInfo,
      interceptLogs: sourceResult.interceptLogs,
      tokenUsage,
      timing: { imileMs, aiMs },
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '分析失败' })
  }
})
