import { eq } from 'drizzle-orm'
import { getDb } from '../../db'
import { orderExceptionWarehouseConfigs } from '../../db/schema'
import type { AnalyzeTarget } from '../../openaiOrderAnalyze'
import { reclassifyOutWarehouseLossWithCancelScan } from '../../orderAnalyze/cancelScanReclassify'
import { enrichTheftSuspectDriverVendor } from '../../orderAnalyze/driverVendorEnrich'
import { runOrderAnalyzePipeline } from '../../orderAnalyze/pipeline'
import { DEFAULT_WAREHOUSE_CONFIG, parseWarehouseConfigInput } from '../../orderAnalyze/warehouseProfiles'
import { fetchOrderExceptionSourcesForAnalyze } from '../../routes/orderExceptionData'
import type { JobHandler } from '../types'

export const ORDER_ANALYZE_JOB_TYPE = 'order.analyze'

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

export const orderAnalyzeHandler: JobHandler = {
  type: ORDER_ANALYZE_JOB_TYPE,
  async run(ctx) {
    const params = parsePayload(ctx.job.payload as Record<string, unknown>)
    if (!params) throw new Error('无效的任务参数: 缺少 imileToken 或 orderNos')

    const { imileToken, orderNos, aiProvider, enableAiExplain, scanStationCode } = params

    await ctx.reportProgress({ phase: 'fetching', message: `获取 ${orderNos.length} 个订单数据`, percent: 0 })

    const sourceResult = await fetchOrderExceptionSourcesForAnalyze(imileToken, orderNos)
    if (!sourceResult.ok) throw new Error(`数据获取失败: ${sourceResult.message}`)

    await ctx.reportProgress({ phase: 'analyzing', message: 'AI 分析中', percent: 30 })

    const db = getDb()
    const [configRow] = await db
      .select()
      .from(orderExceptionWarehouseConfigs)
      .where(eq(orderExceptionWarehouseConfigs.configKey, 'global'))
      .limit(1)
    const warehouseConfig = parseWarehouseConfigInput(configRow?.payload ?? DEFAULT_WAREHOUSE_CONFIG)

    const targets: AnalyzeTarget[] = orderNos.map((no) => ({
      orderNo: no,
      tracks: sourceResult.trackInfo[no] ?? [],
      interceptLogs: sourceResult.interceptLogs[no] ?? [],
    }))

    const { results: pipelineResults, tokenUsage, trackFacts } = await runOrderAnalyzePipeline({
      targets,
      aiProvider,
      enableAiExplain,
      warehouseConfig,
    })

    const { results: recheckedResults, meta: cancelScanRecheck } =
      await reclassifyOutWarehouseLossWithCancelScan({
        results: pipelineResults,
        trackFacts,
        imileToken,
        scanStationCode,
      })

    const { results, meta: driverVendorEnrich } = await enrichTheftSuspectDriverVendor({
      results: recheckedResults,
      trackFacts,
      imileToken,
      scanStationCode,
    })

    await ctx.reportProgress({ phase: 'writing', message: '写入结果', percent: 95 })

    const artifactPayload = {
      results,
      trackInfo: sourceResult.trackInfo,
      orderInfo: sourceResult.orderInfo,
      interceptLogs: sourceResult.interceptLogs,
      tokenUsage,
      trackFacts,
      cancelScanRecheck,
      driverVendorEnrich,
    }

    await ctx.reportProgress({ phase: 'done', percent: 100 })
    return { artifactPayload }
  },
}
