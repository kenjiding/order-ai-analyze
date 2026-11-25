import { eq } from 'drizzle-orm'
import { getDb } from '../../db'
import { orderExceptionWarehouseConfigs } from '../../db/schema'
import type { AnalyzeTarget, OrderAnalyzeResult } from '../../openaiOrderAnalyze'
import {
  reclassifyOutWarehouseLossWithCancelScan,
  type CancelScanReclassifyMeta,
} from '../../orderAnalyze/cancelScanReclassify'
import { enrichTheftSuspectDriverVendor, type DriverVendorEnrichMeta } from '../../orderAnalyze/driverVendorEnrich'
import { runOrderAnalyzePipeline } from '../../orderAnalyze/pipeline'
import type { TrackFacts } from '../../orderAnalyze/types'
import { emptyTokenUsage, mergeTokenUsage, type TokenUsage } from '../../orderAnalyze/usage'
import { DEFAULT_WAREHOUSE_CONFIG, parseWarehouseConfigInput } from '../../orderAnalyze/warehouseProfiles'
import type { ScanInterceptLog } from '../../imile/interceptLogs'
import type { OrderQueryInfo, TrackEvent } from '../../imile/track'
import { fetchOrderExceptionSourcesForAnalyze } from '../../routes/orderExceptionData'
import { recordUsage } from '../../orderExceptionUsageStats'
import type { JobHandler } from '../types'

export const ORDER_ANALYZE_JOB_TYPE = 'order.analyze'

/** 单个 iMile 数据抓取 + AI 分析批次的订单数上限，须与 `/analyze` 同步接口保持一致。 */
const CHUNK_SIZE = 1000

type OrderAnalyzePayload = {
  imileToken: string
  orderNos: string[]
  aiProvider: 'openai' | 'deepseek'
  enableAiExplain: boolean
  scanStationCode?: string
}

function parsePayload(raw: Record<string, unknown>): OrderAnalyzePayload | null {
  const imileToken = typeof raw.imileToken === 'string' ? raw.imileToken.trim() : ''
  const orderNos = Array.isArray(raw.orderNos)
    ? raw.orderNos.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean)
    : []
  const aiProvider = String(raw.aiProvider ?? 'deepseek').toLowerCase() === 'openai' ? 'openai' : 'deepseek'
  const enableAiExplain = raw.enableAiExplain === true
  const scanStationCode = typeof raw.scanStationCode === 'string' ? raw.scanStationCode.trim() || undefined : undefined
  if (!imileToken || !orderNos.length) return null
  return { imileToken, orderNos, aiProvider, enableAiExplain, scanStationCode }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function mergeCancelScanMeta(
  a: CancelScanReclassifyMeta,
  b: CancelScanReclassifyMeta
): CancelScanReclassifyMeta {
  return {
    checkedOrderNos: [...a.checkedOrderNos, ...b.checkedOrderNos],
    reclassifiedOrderNos: [...a.reclassifiedOrderNos, ...b.reclassifiedOrderNos],
    error: [a.error, b.error].filter(Boolean).join('; ') || undefined,
  }
}

function mergeDriverVendorMeta(a: DriverVendorEnrichMeta, b: DriverVendorEnrichMeta): DriverVendorEnrichMeta {
  return {
    checkedOrderNos: [...a.checkedOrderNos, ...b.checkedOrderNos],
    enrichedOrderNos: [...a.enrichedOrderNos, ...b.enrichedOrderNos],
    ambiguousOrderNos: [...a.ambiguousOrderNos, ...b.ambiguousOrderNos],
    errors: [...a.errors, ...b.errors],
  }
}

export const orderAnalyzeHandler: JobHandler = {
  type: ORDER_ANALYZE_JOB_TYPE,
  async run(ctx) {
    const params = parsePayload(ctx.job.payload as Record<string, unknown>)
    if (!params) throw new Error('无效的任务参数: 缺少 imileToken 或 orderNos')

    const { imileToken, orderNos, aiProvider, enableAiExplain, scanStationCode } = params

    const db = getDb()
    const [configRow] = await db
      .select()
      .from(orderExceptionWarehouseConfigs)
      .where(eq(orderExceptionWarehouseConfigs.configKey, 'global'))
      .limit(1)
    const warehouseConfig = parseWarehouseConfigInput(configRow?.payload ?? DEFAULT_WAREHOUSE_CONFIG)

    const chunks = chunk(orderNos, CHUNK_SIZE)

    let results: OrderAnalyzeResult[] = []
    const trackInfo: Record<string, TrackEvent[]> = {}
    const orderInfo: Record<string, OrderQueryInfo | null> = {}
    const interceptLogs: Record<string, ScanInterceptLog[]> = {}
    let tokenUsage: TokenUsage = emptyTokenUsage()
    const trackFacts: Record<string, TrackFacts> = {}
    let cancelScanRecheck: CancelScanReclassifyMeta = { checkedOrderNos: [], reclassifiedOrderNos: [] }
    let driverVendorEnrich: DriverVendorEnrichMeta = {
      checkedOrderNos: [],
      enrichedOrderNos: [],
      ambiguousOrderNos: [],
      errors: [],
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunkOrderNos = chunks[i]
      const batchLabel = chunks.length > 1 ? `第 ${i + 1}/${chunks.length} 批，` : ''
      await ctx.reportProgress({
        phase: 'fetching',
        message: `${batchLabel}获取 ${chunkOrderNos.length} 个订单数据`,
        percent: Math.round((i / chunks.length) * 90),
      })

      const sourceResult = await fetchOrderExceptionSourcesForAnalyze(imileToken, chunkOrderNos)
      if (!sourceResult.ok) throw new Error(`数据获取失败: ${sourceResult.message}`)

      await ctx.reportProgress({
        phase: 'analyzing',
        message: `${batchLabel}AI 分析中`,
        percent: Math.round(((i + 0.3) / chunks.length) * 90),
      })

      const targets: AnalyzeTarget[] = chunkOrderNos.map((no) => ({
        orderNo: no,
        tracks: sourceResult.trackInfo[no] ?? [],
        interceptLogs: sourceResult.interceptLogs[no] ?? [],
      }))

      const { results: pipelineResults, tokenUsage: chunkTokenUsage, trackFacts: chunkTrackFacts } =
        await runOrderAnalyzePipeline({ targets, aiProvider, enableAiExplain, warehouseConfig })

      const { results: recheckedResults, meta: chunkCancelScanRecheck } =
        await reclassifyOutWarehouseLossWithCancelScan({
          results: pipelineResults,
          trackFacts: chunkTrackFacts,
          imileToken,
          scanStationCode,
        })

      const { results: chunkResults, meta: chunkDriverVendorEnrich } = await enrichTheftSuspectDriverVendor({
        results: recheckedResults,
        trackFacts: chunkTrackFacts,
        imileToken,
        scanStationCode,
      })

      results = results.concat(chunkResults)
      Object.assign(trackInfo, sourceResult.trackInfo)
      Object.assign(orderInfo, sourceResult.orderInfo)
      Object.assign(interceptLogs, sourceResult.interceptLogs)
      Object.assign(trackFacts, chunkTrackFacts)
      tokenUsage = mergeTokenUsage(tokenUsage, chunkTokenUsage)
      cancelScanRecheck = mergeCancelScanMeta(cancelScanRecheck, chunkCancelScanRecheck)
      driverVendorEnrich = mergeDriverVendorMeta(driverVendorEnrich, chunkDriverVendorEnrich)
    }

    await ctx.reportProgress({ phase: 'writing', message: '写入结果', percent: 95 })

    if (ctx.job.createdBy) recordUsage(ctx.job.createdBy, 'analyzedOrderCount', orderNos.length)

    const artifactPayload = {
      results,
      trackInfo,
      orderInfo,
      interceptLogs,
      tokenUsage,
      trackFacts,
      cancelScanRecheck,
      driverVendorEnrich,
    }

    await ctx.reportProgress({ phase: 'done', percent: 100 })
    return { artifactPayload }
  },
}
