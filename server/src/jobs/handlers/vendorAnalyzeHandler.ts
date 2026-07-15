import {
  fetchBefore11ExitRates,
  fetchComplaintTickets,
  fetchLongTailOrders,
  fetchUnprocessedTickets,
  fetchVendorWaybills,
  type Before11ExitRateResult,
  type SlimPickupRow,
  type UnprocessedTicketsResult,
} from '../../imile/vendorAnalysis'
import {
  fetchDriverReturnWarning,
  fetchDriverWaybills,
  type DriverReturnRow,
  type DriverWaybillRow,
} from '../../imile/driverPerformance'
import { Semaphore } from '../../imile/semaphore'
import { getDb, schema } from '../../db'
import { resolveRegionTz } from '../../imile/ausTimezone'
import type { JobHandler } from '../types'
import { VENDOR_ANALYSIS_DATA_SOURCES, type VendorAnalysisDataSource } from '../../vendorAnalysis/metricsCatalog'
import { aggregateVendorAnalysis, type VendorAnalyzeSummary } from '../../vendorAnalysis/aggregate'
import { populateDriverMapCache } from '../../driverMap/driverMapPointsQuery'

export const VENDOR_ANALYZE_JOB_TYPE = 'vendor.analyze'

// worker 是独立进程，不与 web 进程共享内存，需要单独的信号量限制 iMile 并发
const waybillSearchSemaphore = new Semaphore(1)

type VendorAnalyzePayload = {
  imileToken: string
  stationCodes: string[]
  vendorCodes: string[]
  referenceDate: string
  startTime: string
  endTime: string
  ticketStartTime: string
  ticketEndTime: string
  yesterdayStartTime: string
  yesterdayEndTime: string
  dayBeforeStartTime: string
  dayBeforeEndTime: string
  unprocessedStartTime: string
  before11Date: string
  dayBeforeDate: string
  dataSources: VendorAnalysisDataSource[]
  routeCodesByVendor: Map<string, Set<string>>
  routeCodeWhitelistByVendor: Map<string, Set<string>>
}

function asStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : []
}

/** 老任务 payload 无 dataSources 字段 → 全量抓取（改造前行为） */
function parseDataSources(raw: unknown): VendorAnalysisDataSource[] {
  const valid = new Set<string>(VENDOR_ANALYSIS_DATA_SOURCES)
  const parsed = asStringArray(raw).filter((s): s is VendorAnalysisDataSource => valid.has(s))
  return parsed.length > 0 ? parsed : [...VENDOR_ANALYSIS_DATA_SOURCES]
}

/** 老任务 payload 无对应字段 → 空 map（不收窄 / 无白名单，改造前行为） */
function parseRouteCodeSetByVendor(raw: unknown): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  if (!raw || typeof raw !== 'object') return map
  for (const [vendorCode, codes] of Object.entries(raw as Record<string, unknown>)) {
    const set = new Set(asStringArray(codes))
    if (set.size > 0) map.set(vendorCode, set)
  }
  return map
}

function parsePayload(raw: Record<string, unknown>): VendorAnalyzePayload | null {
  const imileToken = typeof raw.imileToken === 'string' ? raw.imileToken.trim() : ''
  const stationCodes = asStringArray(raw.stationCodes)
  const requiredStrings = [
    'referenceDate', 'startTime', 'endTime', 'ticketStartTime', 'ticketEndTime',
    'yesterdayStartTime', 'yesterdayEndTime', 'dayBeforeStartTime', 'dayBeforeEndTime',
    'unprocessedStartTime', 'before11Date', 'dayBeforeDate',
  ] as const
  for (const key of requiredStrings) {
    if (typeof raw[key] !== 'string' || !(raw[key] as string).trim()) return null
  }
  if (!imileToken) return null

  return {
    imileToken,
    stationCodes,
    vendorCodes: asStringArray(raw.vendorCodes),
    referenceDate: raw.referenceDate as string,
    startTime: raw.startTime as string,
    endTime: raw.endTime as string,
    ticketStartTime: raw.ticketStartTime as string,
    ticketEndTime: raw.ticketEndTime as string,
    yesterdayStartTime: raw.yesterdayStartTime as string,
    yesterdayEndTime: raw.yesterdayEndTime as string,
    dayBeforeStartTime: raw.dayBeforeStartTime as string,
    dayBeforeEndTime: raw.dayBeforeEndTime as string,
    unprocessedStartTime: raw.unprocessedStartTime as string,
    before11Date: raw.before11Date as string,
    dayBeforeDate: raw.dayBeforeDate as string,
    dataSources: parseDataSources(raw.dataSources),
    routeCodesByVendor: parseRouteCodeSetByVendor(raw.routeCodesByVendor),
    routeCodeWhitelistByVendor: parseRouteCodeSetByVendor(raw.routeCodeWhitelistByVendor),
  }
}

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

export const vendorAnalyzeHandler: JobHandler = {
  type: VENDOR_ANALYZE_JOB_TYPE,
  async run(ctx) {
    const params = parsePayload(ctx.job.payload as Record<string, unknown>)
    if (!params) throw new Error('无效的任务参数')
    const { imileToken } = params
    const enabledSources = new Set<VendorAnalysisDataSource>(params.dataSources)

    // 跳过的数据源保持空值：前端聚合对空数组/空 map 天然产出 0 或 null，未勾选指标由渲染层过滤
    let tickets: unknown[] = []
    let unprocessedTickets: UnprocessedTicketsResult = { normalTickets: [], complaintTickets: [], arbitrationTickets: [] }
    let longTailOrders: unknown[] = []
    let before11ExitRateByVendor: Record<string, Before11ExitRateResult> = {}
    let driverYesterdayWaybills: SlimPickupRow[] = []
    let slimmedWaybills: Record<string, unknown>[] = []
    let driverDayBeforeWaybills: DriverWaybillRow[] = []
    let driverReturnRows: DriverReturnRow[] = []

    function requireBefore11StationCode(): string {
      const code = params!.stationCodes[0]?.trim()
      if (!code) throw new Error('缺少责任站点 stationCode')
      return code
    }

    // 与 metricsCatalog 的 dataSource key 一一对应；按勾选指标解析出的并集过滤后顺序执行
    const stages: Array<{
      source: VendorAnalysisDataSource
      phase: string
      message: string
      run: () => Promise<void>
    }> = [
      {
        source: 'tickets',
        phase: 'tickets',
        message: '获取客诉工单',
        run: async () => {
          const res = await fetchComplaintTickets(imileToken, {
            startTime: params.ticketStartTime,
            endTime: params.ticketEndTime,
          })
          if (!res.ok) throw new Error(`客诉工单获取失败: ${res.message}`)
          tickets = res.data
        },
      },
      {
        source: 'unprocessed',
        phase: 'unprocessed',
        message: '获取未处理工单',
        run: async () => {
          const res = await fetchUnprocessedTickets(imileToken, {
            startTime: params.unprocessedStartTime,
            endTime: params.yesterdayEndTime,
          })
          if (!res.ok) throw new Error(`未处理工单获取失败: ${res.message}`)
          unprocessedTickets = res.data
        },
      },
      {
        source: 'longTail',
        phase: 'longTail',
        message: '获取长尾单',
        run: async () => {
          const res = await fetchLongTailOrders(imileToken, { stationCodes: params.stationCodes })
          if (!res.ok) throw new Error(`长尾单获取失败: ${res.message}`)
          longTailOrders = res.data
        },
      },
      {
        source: 'before11',
        phase: 'before11',
        // 该数据源同时服务「11点前出仓率」「今日取件」「司机11点前出率」3 个指标，进度文案不能只提其中一个
        message: '获取出仓/取件数据',
        run: async () => {
          const res = await waybillSearchSemaphore.run(() =>
            fetchBefore11ExitRates(imileToken, {
              stationCode: requireBefore11StationCode(),
              dateStr: params.before11Date,
              vendorCodes: params.vendorCodes,
              regionCode: ctx.job.regionCode,
              routeCodeWhitelistByVendor: params.routeCodeWhitelistByVendor,
            }),
          )
          if (!res.ok) throw new Error(`11点前出仓率获取失败: ${res.message}`)
          before11ExitRateByVendor = res.data.ratesByVendor
          driverYesterdayWaybills = res.data.pickupRows
        },
      },
      {
        source: 'waybills',
        phase: 'waybills',
        message: '获取运单数据',
        run: async () => {
          const res = await waybillSearchSemaphore.run(() =>
            fetchVendorWaybills(imileToken, { startTime: params.startTime, endTime: params.endTime }),
          )
          if (!res.ok) throw new Error(`运单获取失败: ${res.message}`)
          slimmedWaybills = res.data.map(slimWaybill)
        },
      },
      {
        source: 'driverWaybills',
        phase: 'driverWaybills',
        message: '获取司机运单(24H派签)',
        run: async () => {
          const res = await waybillSearchSemaphore.run(() =>
            fetchDriverWaybills(imileToken, {
              stationCode: requireBefore11StationCode(),
              dateStr: params.dayBeforeDate,
              regionCode: ctx.job.regionCode,
            }),
          )
          if (!res.ok) throw new Error(`司机运单获取失败: ${res.message}`)
          driverDayBeforeWaybills = res.data
        },
      },
      {
        source: 'driverReturn',
        phase: 'driverReturn',
        message: '获取司机归班预警',
        run: async () => {
          const res = await fetchDriverReturnWarning(imileToken, { stationCodes: params.stationCodes })
          if (!res.ok) throw new Error(`司机归班预警获取失败: ${res.message}`)
          driverReturnRows = res.data
        },
      },
      {
        source: 'driverMap',
        phase: 'driverMap',
        // 与 before11 同一天：签收/未签收/问题件写入司机地图缓存；后续「刷新」只增量更新未终态
        message: '同步司机地图(出仓日)',
        run: async () => {
          const res = await waybillSearchSemaphore.run(() =>
            populateDriverMapCache({
              token: imileToken,
              stationCode: requireBefore11StationCode(),
              dataDate: params.before11Date,
              tz: resolveRegionTz(ctx.job.regionCode),
              label: '司机地图(分析任务出仓日)',
            }),
          )
          if (!res.ok) throw new Error(`司机地图同步失败: ${res.message}`)
        },
      },
    ]

    const enabledStages = stages.filter((stage) => enabledSources.has(stage.source))
    for (const [index, stage] of enabledStages.entries()) {
      await ctx.reportProgress({
        phase: stage.phase,
        message: stage.message,
        percent: Math.round((index / enabledStages.length) * 95),
        step: index + 1,
        totalSteps: enabledStages.length,
      })
      await stage.run()
    }

    await ctx.reportProgress({
      phase: 'writing',
      message: '写入结果',
      percent: 95,
      step: enabledStages.length,
      totalSteps: enabledStages.length,
    })

    // 原始明细就地聚合成「汇总结果」，只落汇总（不再存海量原始行）。
    // 站点口径用任务的 stationCodes 冻结；tz 由账号所属州决定；nowMs=完成时刻（归班 48h 基准）。
    const nowMs = Date.now()
    const vendors = aggregateVendorAnalysis({
      tickets: tickets as never,
      waybills: slimmedWaybills as never,
      unprocessedTickets: unprocessedTickets as never,
      longTailOrders: longTailOrders as never,
      before11ExitRateByVendor,
      driverYesterdayWaybills,
      driverDayBeforeWaybills: driverDayBeforeWaybills as never,
      driverReturnRows: driverReturnRows as never,
      stationCodes: params.stationCodes,
      tz: resolveRegionTz(ctx.job.regionCode),
      nowMs,
      routeCodesByVendor: params.routeCodesByVendor,
      routeCodeWhitelistByVendor: params.routeCodeWhitelistByVendor,
    })

    const artifactData: VendorAnalyzeSummary = {
      schemaVersion: 2,
      referenceDate: params.referenceDate,
      // 本次实际抓取的数据源；前端据此判断新勾选指标是否需要重新获取数据
      dataSources: [...enabledSources].sort(),
      stationCodes: params.stationCodes,
      startTime: params.startTime,
      endTime: params.endTime,
      ticketStartTime: params.ticketStartTime,
      ticketEndTime: params.ticketEndTime,
      before11Date: params.before11Date,
      dayBeforeDate: params.dayBeforeDate,
      computedAt: new Date(nowMs).toISOString(),
      vendors,
    }

    // 汇总分析结果长期存库，不依赖 jobs.artifactPath 的文件+TTL 清理机制，支持长期回溯
    const db = getDb()
    await db.insert(schema.vendorAnalysisSnapshots).values({
      jobId: ctx.job.id,
      regionCode: ctx.job.regionCode,
      referenceDate: params.referenceDate,
      stationCodes: params.stationCodes,
      payload: artifactData,
      createdBy: ctx.job.createdBy,
    })

    await ctx.reportProgress({
      phase: 'done',
      message: '完成',
      percent: 100,
      step: enabledStages.length,
      totalSteps: enabledStages.length,
    })
    return {}
  },
}
