import {
  fetchBefore11ExitRates,
  fetchComplaintTickets,
  fetchLongTailOrders,
  fetchUnprocessedTickets,
  fetchVendorWaybills,
} from '../../imile/vendorAnalysis'
import { fetchDriverReturnWarning, fetchDriverWaybills } from '../../imile/driverPerformance'
import { Semaphore } from '../../imile/semaphore'
import { getDb, schema } from '../../db'
import type { JobHandler } from '../types'

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
}

function asStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : []
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

    await ctx.reportProgress({ phase: 'tickets', message: '获取客诉工单', percent: 0, step: 1, totalSteps: 7 })
    const ticketsRes = await fetchComplaintTickets(imileToken, {
      startTime: params.ticketStartTime,
      endTime: params.ticketEndTime,
    })
    if (!ticketsRes.ok) throw new Error(`客诉工单获取失败: ${ticketsRes.message}`)

    await ctx.reportProgress({ phase: 'unprocessed', message: '获取未处理工单', percent: 14, step: 2, totalSteps: 7 })
    const unprocessedRes = await fetchUnprocessedTickets(imileToken, {
      startTime: params.unprocessedStartTime,
      endTime: params.yesterdayEndTime,
    })
    if (!unprocessedRes.ok) throw new Error(`未处理工单获取失败: ${unprocessedRes.message}`)

    await ctx.reportProgress({ phase: 'longTail', message: '获取长尾单', percent: 28, step: 3, totalSteps: 7 })
    const longTailRes = await fetchLongTailOrders(imileToken, { stationCodes: params.stationCodes })
    if (!longTailRes.ok) throw new Error(`长尾单获取失败: ${longTailRes.message}`)

    await ctx.reportProgress({ phase: 'before11', message: '获取11点前出仓率', percent: 42, step: 4, totalSteps: 7 })
    const before11StationCode = params.stationCodes[0]?.trim()
    if (!before11StationCode) throw new Error('缺少责任站点 stationCode')
    const before11Res = await waybillSearchSemaphore.run(() =>
      fetchBefore11ExitRates(imileToken, {
        stationCode: before11StationCode,
        dateStr: params.before11Date,
        vendorCodes: params.vendorCodes,
        regionCode: ctx.job.regionCode,
      }),
    )
    if (!before11Res.ok) throw new Error(`11点前出仓率获取失败: ${before11Res.message}`)

    await ctx.reportProgress({ phase: 'waybills', message: '获取运单数据', percent: 56, step: 5, totalSteps: 7 })
    const waybillsRes = await waybillSearchSemaphore.run(() =>
      fetchVendorWaybills(imileToken, { startTime: params.startTime, endTime: params.endTime }),
    )
    if (!waybillsRes.ok) throw new Error(`运单获取失败: ${waybillsRes.message}`)
    const slimmedWaybills = waybillsRes.data.map(slimWaybill)

    await ctx.reportProgress({ phase: 'driverWaybills', message: '获取司机运单(24H派签)', percent: 70, step: 6, totalSteps: 7 })
    const driverDayBeforeRes = await waybillSearchSemaphore.run(() =>
      fetchDriverWaybills(imileToken, {
        stationCode: before11StationCode,
        dateStr: params.dayBeforeDate,
        regionCode: ctx.job.regionCode,
      }),
    )
    if (!driverDayBeforeRes.ok) throw new Error(`司机运单获取失败: ${driverDayBeforeRes.message}`)

    await ctx.reportProgress({ phase: 'driverReturn', message: '获取司机归班预警', percent: 84, step: 7, totalSteps: 7 })
    const driverReturnRes = await fetchDriverReturnWarning(imileToken, { stationCodes: params.stationCodes })
    if (!driverReturnRes.ok) throw new Error(`司机归班预警获取失败: ${driverReturnRes.message}`)

    await ctx.reportProgress({ phase: 'writing', message: '写入结果', percent: 95, step: 7, totalSteps: 7 })

    const artifactData = {
      referenceDate: params.referenceDate,
      tickets: ticketsRes.data,
      waybills: slimmedWaybills,
      unprocessedTickets: unprocessedRes.data,
      longTailOrders: longTailRes.data,
      before11ExitRateByVendor: before11Res.data.ratesByVendor,
      driverYesterdayWaybills: before11Res.data.pickupRows,
      driverDayBeforeWaybills: driverDayBeforeRes.data,
      driverReturnRows: driverReturnRes.data,
      startTime: params.startTime,
      endTime: params.endTime,
      ticketStartTime: params.ticketStartTime,
      ticketEndTime: params.ticketEndTime,
      before11Date: params.before11Date,
      dayBeforeDate: params.dayBeforeDate,
    }

    // 完整分析结果长期存库，不依赖 jobs.artifactPath 的文件+TTL 清理机制，支持长期回溯
    const db = getDb()
    await db.insert(schema.vendorAnalysisSnapshots).values({
      jobId: ctx.job.id,
      regionCode: ctx.job.regionCode,
      referenceDate: params.referenceDate,
      stationCodes: params.stationCodes,
      payload: artifactData,
      createdBy: ctx.job.createdBy,
    })

    await ctx.reportProgress({ phase: 'done', message: '完成', percent: 100, step: 7, totalSteps: 7 })
    return {}
  },
}
