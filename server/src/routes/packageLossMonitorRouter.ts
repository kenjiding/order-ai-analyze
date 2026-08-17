import { eq } from 'drizzle-orm'
import { Router, type Request, type Response } from 'express'
import { fetchInHubPackageLossWaybills } from '../imile/inHubWaybillInventory'
import { queryClosedPacketLossWaybills } from '../imile/closure'
import { getDb } from '../db'
import { orderExceptionWarehouseConfigs } from '../db/schema'
import { DEFAULT_WAREHOUSE_CONFIG, applyLossTimeoutDaysOverride, parseWarehouseConfigInput } from '../orderAnalyze/warehouseProfiles'
import { fetchOrderExceptionSourcesForAnalyze } from './orderExceptionData'
import { runOrderAnalyzePipeline } from '../orderAnalyze/pipeline'
import { reclassifyOutWarehouseLossWithCancelScan } from '../orderAnalyze/cancelScanReclassify'
import { enrichTheftSuspectDriverVendor } from '../orderAnalyze/driverVendorEnrich'
import type { AnalyzeTarget } from '../openaiOrderAnalyze'
import { stripStationLossClosureEvents } from '../orderAnalyze/trackFacts'
import { readImileTokenFromRequest } from './imileAuth'

export const packageLossMonitorRouter = Router()

function readOptionalPositiveInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || n < 1) return undefined
  return Math.floor(n)
}

function parseTimeRangeInput(value: unknown): Date | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isFinite(date.getTime()) ? date : null
}

export function isTimeRangeWithin31Days(start: unknown, end: unknown): boolean {
  const startAt = parseTimeRangeInput(start)
  const endAt = parseTimeRangeInput(end)
  if (!startAt || !endAt) return false
  if (endAt.getTime() < startAt.getTime()) return false
  const diffMs = endAt.getTime() - startAt.getTime()
  return diffMs <= 31 * 24 * 60 * 60 * 1000
}

export function mergePackageLossWaybillNos(
  inventoryWaybillNos: readonly string[],
  closedWaybillNos: readonly string[],
): string[] {
  return [
    ...new Set<string>([
      ...inventoryWaybillNos.map((item) => item.trim()).filter(Boolean),
      ...closedWaybillNos.map((item) => item.trim()).filter(Boolean),
    ]),
  ]
}

packageLossMonitorRouter.post('/in-hub-waybills', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      imileToken?: string
      stationCode?: string
      start?: string
      end?: string
    }
    const token = readImileTokenFromRequest(req, body.imileToken, { allowQuery: true })
    const stationCode = String(body.stationCode ?? '').trim()
    const start = String(body.start ?? '').trim()
    const end = String(body.end ?? '').trim()

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken' })
      return
    }
    if (!stationCode) {
      res.status(400).json({ error: '缺少责任站点编码' })
      return
    }
    if (!start || !end) {
      res.status(400).json({ error: '缺少时间范围，请选择开始与结束时间' })
      return
    }
    if (!isTimeRangeWithin31Days(start, end)) {
      res.status(400).json({ error: '异常完结查询时间范围不能超过 1 个月，且结束时间不能早于开始时间' })
      return
    }

    const [inventoryResult, closedResult] = await Promise.all([
      fetchInHubPackageLossWaybills(token, stationCode),
      queryClosedPacketLossWaybills({ imileToken: token, start, end }),
    ])

    if (!inventoryResult.ok) {
      res.status(502).json({
        error: inventoryResult.message,
        status: inventoryResult.status,
        rawText: inventoryResult.rawText,
      })
      return
    }
    if (!closedResult.ok) {
      res.status(502).json({
        error: closedResult.message,
        status: closedResult.status,
        rawText: closedResult.rawText,
      })
      return
    }

    const merged = mergePackageLossWaybillNos(inventoryResult.waybillNos, closedResult.waybillNos)

    res.json({
      waybillNos: merged,
      total: merged.length,
      byScanType: inventoryResult.byScanType,
      exceptionClosedCount: closedResult.waybillNos.length,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '库内丢包运单查询失败' })
  }
})

packageLossMonitorRouter.post('/analyze', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      imileToken?: string
      orderNos?: string[]
      scanStationCode?: string
      lossTimeoutDays?: unknown
    }
    const token = readImileTokenFromRequest(req, body.imileToken, { allowQuery: true })
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

    const targets: AnalyzeTarget[] = orderNos.map((orderNo) => ({
      orderNo,
      tracks: stripStationLossClosureEvents(sourceResult.trackInfo[orderNo] ?? []),
      interceptLogs: sourceResult.interceptLogs[orderNo] ?? [],
    }))

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

    const aiStartedAt = performance.now()
    const { results: pipelineResults, tokenUsage, trackFacts } = await runOrderAnalyzePipeline({
      targets,
      aiProvider: 'deepseek',
      enableAiExplain: false,
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
    res.status(500).json({ error: (e as Error).message || '库内丢包分析失败' })
  }
})
