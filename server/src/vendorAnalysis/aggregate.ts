/**
 * 供应商数据分析——把 worker 抓到的原始明细行聚合成「汇总结果」的纯函数。
 *
 * 由 vendorAnalyzeHandler 在任务完成时调用，产出的 VendorAnalyzeSummary 直接落库，
 * 前端不再持有原始明细、也不再在浏览器现算。聚合口径与旧前端 useVendorAnalysisPage
 * 里的 indexedData / vendorMetrics / driverPerformanceByVendor 逐条对齐。
 *
 * 关键约定：
 * - 结果按 vendorCode 组织，不含供应商名称/昵称/配置 id（那些是配置数据，前端渲染时按 vendorCode join）。
 * - 站点口径来自任务的 stationCodes（冻结），不再随查看时的全局筛选变化。
 * - 24H 内比较、归班 48h、"现在"均为绝对时刻，与时区无关；仅「星期判断」和「周五~日的下周一 23:59:59
 *   截止」依赖 targetTz。nowMs = worker 完成时刻。
 */
import { iMileStrToMs, type AusTz } from '../imile/ausTimezone'
import type { Before11ExitRateResult, SlimPickupRow } from '../imile/vendorAnalysis'
import { aggregateDispatch24hByVendor, isDispatch24hMet } from './dispatch24hAggregate'

// ── 输入行类型：只声明聚合真正读取的字段（运行时行还带其它字段，此处不关心） ──

type ComplaintTicketRow = {
  relatedResponsibleHubCode?: string
  responsibleDeptCode?: string
  orderCode?: unknown
}

type NormalUnprocessedTicketRow = {
  currentHandleStationCode?: string
  currentHandleCode?: string
  orderCode?: unknown
}

type HubUnprocessedTicketRow = {
  relatedResponsibleHubCode?: string
  responsibleDeptCode?: string
  orderCode?: unknown
}

type LongTailOrderRow = {
  driverVendorCode?: string
  driverName?: string
  driverCode?: string
  waybillNo?: string
}

type WaybillRow = {
  courierVendorCode?: string
  consigneeRouteCode?: string
}

type DriverWaybillRow = {
  waybillNo?: string
  courier?: string
  courierCode?: string
  courierVendorCode?: string
  consigneeRouteCode?: string
  signDate?: string
  deliveryTime?: string
  lastScanSiteCode?: string
  lastProblemDate?: string
  before11Exit?: boolean
}

type DriverReturnRow = {
  driverName?: string
  driverCode?: string
  driverVendorCode?: string
  ofdDate?: string
  waybillNo?: string
}

export type VendorAnalyzeAggregateInput = {
  tickets: ComplaintTicketRow[]
  waybills: WaybillRow[]
  unprocessedTickets: {
    normalTickets: NormalUnprocessedTicketRow[]
    complaintTickets: HubUnprocessedTicketRow[]
    arbitrationTickets: HubUnprocessedTicketRow[]
  }
  longTailOrders: LongTailOrderRow[]
  before11ExitRateByVendor: Record<string, Before11ExitRateResult>
  driverYesterdayWaybills: SlimPickupRow[]
  driverDayBeforeWaybills: DriverWaybillRow[]
  driverReturnRows: DriverReturnRow[]
  stationCodes: string[]
  tz: AusTz
  /** worker 完成时刻，用作归班预警 48h 的基准 */
  nowMs: number
  /** 路由码白名单：命中的路由码代表要从该供应商统计中剔除的数据 */
  routeCodeWhitelistByVendor: Map<string, Set<string>>
}

// ── 输出汇总类型（前端 vendorAnalysisSummary.ts 镜像同一结构） ──

export type DriverSummary = {
  courierCode: string
  courierName: string
  routeCode: string
  ofdCount: number
  ofdWaybillNos: string[]
  before11OfdCount: number
  before11UnmetWaybillNos: string[]
  returnWarningCount: number
  returnWarningWaybillNos: string[]
  dispatch24hCount: number
  totalDispatchCount: number
  dispatchRate24h: number | null
  dispatch24hUnmetWaybillNos: string[]
  longTailCount: number
  longTailWaybillNos: string[]
}

export type VendorSummary = {
  vendorCode: string
  complaintCount: number
  waybillCount: number
  complaintRate: number
  complaintOrderCodes: string[]
  unprocessedTicketCount: number
  unprocessedTicketOrderCodes: string[]
  longTailCount: number
  before11ExitRate: number | null
  before11ExitVolume: number | null
  before11TotalReceived: number | null
  before11UnmetWaybillNos: string[]
  dispatchRate24hText: string | null
  notMet24hSignCount: number | null
  dispatch24hTotal: number | null
  dispatch24hCount: number | null
  dispatch24hUnmetWaybillNos: string[]
  drivers: DriverSummary[]
}

/** 落库的汇总 artifact（前端 vendorAnalysisSummary.ts 镜像同一结构） */
export type VendorAnalyzeSummary = {
  schemaVersion: 2
  referenceDate: string
  dataSources: string[]
  stationCodes: string[]
  startTime: string
  endTime: string
  ticketStartTime: string
  ticketEndTime: string
  before11Date: string
  dayBeforeDate: string
  /** worker 完成时刻（ISO），归班预警 48h 的基准 */
  computedAt: string
  vendors: VendorSummary[]
}

function norm(code: unknown): string {
  return typeof code === 'string' ? code.trim() : ''
}

/** 路由码白名单命中：该供应商这条数据要剔除，不参与统计 */
function isWhitelisted(
  vendorCode: string,
  routeCode: string,
  routeCodeWhitelistByVendor: Map<string, Set<string>>,
): boolean {
  return routeCodeWhitelistByVendor.get(vendorCode)?.has(routeCode.trim()) ?? false
}

export function aggregateVendorAnalysis(input: VendorAnalyzeAggregateInput): VendorSummary[] {
  const {
    tickets,
    waybills,
    unprocessedTickets,
    longTailOrders,
    before11ExitRateByVendor,
    driverYesterdayWaybills,
    driverDayBeforeWaybills,
    driverReturnRows,
    stationCodes,
    tz,
    nowMs,
    routeCodeWhitelistByVendor,
  } = input

  const stationSet = new Set(stationCodes.map((s) => s.trim()).filter(Boolean))
  const inStation = (code: string | undefined) => stationSet.size === 0 || stationSet.has(norm(code))

  // ── 供应商级：客诉、运单、长尾、未处理工单、24H派签、11点前未出仓 ──
  const complaintByVendor = new Map<string, { count: number; orderCodes: string[] }>()
  for (const t of tickets) {
    if (!inStation(t.relatedResponsibleHubCode)) continue
    const key = norm(t.responsibleDeptCode)
    let agg = complaintByVendor.get(key)
    if (!agg) { agg = { count: 0, orderCodes: [] }; complaintByVendor.set(key, agg) }
    agg.count += 1
    const code = typeof t.orderCode === 'string' ? t.orderCode : String(t.orderCode ?? '')
    if (code) agg.orderCodes.push(code)
  }

  const waybillCountByVendor = new Map<string, number>()
  for (const w of waybills) {
    const key = norm(w.courierVendorCode)
    if (isWhitelisted(key, norm(w.consigneeRouteCode), routeCodeWhitelistByVendor)) continue
    waybillCountByVendor.set(key, (waybillCountByVendor.get(key) ?? 0) + 1)
  }

  const longTailCountByVendor = new Map<string, number>()
  for (const o of longTailOrders) {
    const key = norm(o.driverVendorCode)
    longTailCountByVendor.set(key, (longTailCountByVendor.get(key) ?? 0) + 1)
  }

  const unprocessedByVendor = new Map<string, { count: number; orderCodes: string[] }>()
  const addUnprocessed = (key: string, orderCode: unknown) => {
    let agg = unprocessedByVendor.get(key)
    if (!agg) { agg = { count: 0, orderCodes: [] }; unprocessedByVendor.set(key, agg) }
    agg.count += 1
    const code = typeof orderCode === 'string' ? orderCode : ''
    if (code) agg.orderCodes.push(code)
  }
  for (const t of unprocessedTickets.normalTickets) {
    if (!inStation(t.currentHandleStationCode)) continue
    addUnprocessed(norm(t.currentHandleCode), t.orderCode)
  }
  for (const t of [...unprocessedTickets.complaintTickets, ...unprocessedTickets.arbitrationTickets]) {
    if (!inStation(t.relatedResponsibleHubCode)) continue
    addUnprocessed(norm(t.responsibleDeptCode), t.orderCode)
  }

  // 24H派签率：前天运单，按最新派件网点（lastScanSiteCode）过滤后按供应商统计
  const dispatch24hByVendor = aggregateDispatch24hByVendor({
    rows: driverDayBeforeWaybills,
    stationCodes,
    tz,
    routeCodeWhitelistByVendor,
  })

  // 11点前未出仓单号：按供应商聚合（无站点过滤，与 before11ExitRate 口径一致）
  const before11UnmetByVendor = new Map<string, string[]>()
  for (const row of driverYesterdayWaybills) {
    if (row.before11Exit) continue
    const vendorCode = norm(row.courierVendorCode)
    if (!vendorCode) continue
    if (isWhitelisted(vendorCode, norm(row.consigneeRouteCode), routeCodeWhitelistByVendor)) continue
    const wbNo = row.waybillNo ?? ''
    if (!wbNo) continue
    let arr = before11UnmetByVendor.get(vendorCode)
    if (!arr) { arr = []; before11UnmetByVendor.set(vendorCode, arr) }
    arr.push(wbNo)
  }

  // ── 司机级：归班预警按 driverCode 全局聚合（以 nowMs 为基准 48h） ──
  const returnWarningByDriver = new Map<string, { count: number; waybillNos: string[] }>()
  for (const row of driverReturnRows) {
    const driverCode = norm(row.driverCode)
    if (!driverCode || !row.ofdDate) continue
    if (nowMs - iMileStrToMs(row.ofdDate) >= 48 * 60 * 60 * 1000) {
      const entry = returnWarningByDriver.get(driverCode) ?? { count: 0, waybillNos: [] }
      entry.count += 1
      if (row.waybillNo) entry.waybillNos.push(row.waybillNo)
      returnWarningByDriver.set(driverCode, entry)
    }
  }

  // 参与统计的供应商集合：任一数据源出现过的 vendorCode 并集
  const vendorCodes = new Set<string>()
  for (const k of complaintByVendor.keys()) if (k) vendorCodes.add(k)
  for (const k of waybillCountByVendor.keys()) if (k) vendorCodes.add(k)
  for (const k of longTailCountByVendor.keys()) if (k) vendorCodes.add(k)
  for (const k of unprocessedByVendor.keys()) if (k) vendorCodes.add(k)
  for (const k of dispatch24hByVendor.keys()) if (k) vendorCodes.add(k)
  for (const k of before11UnmetByVendor.keys()) if (k) vendorCodes.add(k)
  for (const k of Object.keys(before11ExitRateByVendor)) if (norm(k)) vendorCodes.add(norm(k))
  for (const r of driverYesterdayWaybills) if (norm(r.courierVendorCode)) vendorCodes.add(norm(r.courierVendorCode))
  for (const r of driverDayBeforeWaybills) if (norm(r.courierVendorCode)) vendorCodes.add(norm(r.courierVendorCode))
  for (const r of longTailOrders) if (norm(r.driverVendorCode)) vendorCodes.add(norm(r.driverVendorCode))
  for (const r of driverReturnRows) if (norm(r.driverVendorCode)) vendorCodes.add(norm(r.driverVendorCode))

  const summaries: VendorSummary[] = []
  for (const vendorCode of vendorCodes) {
    const drivers = buildDriverSummaries(vendorCode, input, returnWarningByDriver)

    const complaint = complaintByVendor.get(vendorCode)
    const complaintCount = complaint?.count ?? 0
    const waybillCount = waybillCountByVendor.get(vendorCode) ?? 0
    const dispatch = dispatch24hByVendor.get(vendorCode)
    const before11 = before11ExitRateByVendor[vendorCode]

    summaries.push({
      vendorCode,
      complaintCount,
      waybillCount,
      complaintRate: waybillCount > 0 ? complaintCount / waybillCount : 0,
      complaintOrderCodes: complaint?.orderCodes ?? [],
      unprocessedTicketCount: unprocessedByVendor.get(vendorCode)?.count ?? 0,
      unprocessedTicketOrderCodes: unprocessedByVendor.get(vendorCode)?.orderCodes ?? [],
      longTailCount: longTailCountByVendor.get(vendorCode) ?? 0,
      before11ExitRate: before11?.before11ExitRate ?? null,
      before11ExitVolume: before11?.before11ExitVolume ?? null,
      before11TotalReceived: before11?.totalReceived ?? null,
      before11UnmetWaybillNos: before11UnmetByVendor.get(vendorCode) ?? [],
      dispatchRate24hText: dispatch && dispatch.total > 0
        ? `${((dispatch.met / dispatch.total) * 100).toFixed(2)}%`
        : null,
      notMet24hSignCount: dispatch ? dispatch.total - dispatch.met : null,
      dispatch24hTotal: dispatch?.total ?? null,
      dispatch24hCount: dispatch?.met ?? null,
      dispatch24hUnmetWaybillNos: dispatch?.unmetNos ?? [],
      drivers,
    })
  }

  return summaries
}

/** 某供应商下的司机绩效行：合并取件 + 24H派签 + 归班预警 + 长尾 四个来源 */
function buildDriverSummaries(
  vendorCode: string,
  input: VendorAnalyzeAggregateInput,
  returnWarningByDriver: Map<string, { count: number; waybillNos: string[] }>,
): DriverSummary[] {
  const {
    driverYesterdayWaybills,
    driverDayBeforeWaybills,
    longTailOrders,
    driverReturnRows,
    stationCodes,
    tz,
    routeCodeWhitelistByVendor,
  } = input
  const stationSet = new Set(stationCodes.map((s) => s.trim()).filter(Boolean))
  const inStation = (code: string | undefined) => stationSet.size === 0 || stationSet.has(norm(code))

  // 今日取件量：昨日运单，按 courierVendorCode 匹配，按 courierCode 计数
  type PickupAgg = { courierName: string; routeCode: string; count: number; before11Count: number; waybillNos: string[]; before11UnmetWaybillNos: string[] }
  const pickupMap = new Map<string, PickupAgg>()
  for (const row of driverYesterdayWaybills) {
    if (!row.courierCode || norm(row.courierVendorCode) !== vendorCode) continue
    if (isWhitelisted(vendorCode, norm(row.consigneeRouteCode), routeCodeWhitelistByVendor)) continue
    const wbNo = row.waybillNo ?? ''
    const agg = pickupMap.get(row.courierCode)
    if (agg) {
      agg.count += 1
      if (row.before11Exit) agg.before11Count += 1
      else if (wbNo) agg.before11UnmetWaybillNos.push(wbNo)
      if (wbNo) agg.waybillNos.push(wbNo)
    } else {
      pickupMap.set(row.courierCode, {
        courierName: row.courier ?? '',
        routeCode: row.consigneeRouteCode ?? '',
        count: 1,
        before11Count: row.before11Exit ? 1 : 0,
        waybillNos: wbNo ? [wbNo] : [],
        before11UnmetWaybillNos: !row.before11Exit && wbNo ? [wbNo] : [],
      })
    }
  }

  // 24H派签率：前天运单，按站点+供应商过滤，按司机聚合达标情况
  type DispatchAgg = { total: number; completed: number; routeCode: string; unmetNos: string[] }
  const dispatchMap = new Map<string, DispatchAgg>()
  for (const row of driverDayBeforeWaybills) {
    if (!row.courierCode || norm(row.courierVendorCode) !== vendorCode) continue
    if (isWhitelisted(vendorCode, norm(row.consigneeRouteCode), routeCodeWhitelistByVendor)) continue
    if (!row.deliveryTime) continue
    if (!inStation(row.lastScanSiteCode)) continue
    const completed = isDispatch24hMet(row, tz)
    const wbNo = row.waybillNo ?? ''
    const agg = dispatchMap.get(row.courierCode)
    if (agg) {
      agg.total += 1
      if (completed) agg.completed += 1
      else if (wbNo) agg.unmetNos.push(wbNo)
    } else {
      dispatchMap.set(row.courierCode, {
        total: 1,
        completed: completed ? 1 : 0,
        routeCode: row.consigneeRouteCode ?? '',
        unmetNos: !completed && wbNo ? [wbNo] : [],
      })
    }
  }

  // 长尾单：按司机 driverCode 聚合（与当前供应商匹配）
  type LongTailAgg = { count: number; waybillNos: string[] }
  const longTailByDriver = new Map<string, LongTailAgg>()
  for (const order of longTailOrders) {
    if (!order.driverCode || norm(order.driverVendorCode) !== vendorCode) continue
    const waybillNo = typeof order.waybillNo === 'string' ? order.waybillNo : ''
    const agg = longTailByDriver.get(order.driverCode)
    if (agg) {
      agg.count += 1
      if (waybillNo) agg.waybillNos.push(waybillNo)
    } else {
      longTailByDriver.set(order.driverCode, { count: 1, waybillNos: waybillNo ? [waybillNo] : [] })
    }
  }

  // 合并四个来源的司机集合
  const allCourierCodes = new Set<string>([
    ...pickupMap.keys(),
    ...dispatchMap.keys(),
    ...longTailByDriver.keys(),
    ...[...returnWarningByDriver.keys()].filter((code) =>
      driverReturnRows.some((r) => norm(r.driverCode) === code && norm(r.driverVendorCode) === vendorCode),
    ),
  ])

  const drivers: DriverSummary[] = []
  for (const courierCode of allCourierCodes) {
    const pickup = pickupMap.get(courierCode)
    const dispatch = dispatchMap.get(courierCode)

    let courierName = pickup?.courierName ?? ''
    if (!courierName) {
      courierName = driverDayBeforeWaybills.find(
        (r) => r.courierCode === courierCode && norm(r.courierVendorCode) === vendorCode,
      )?.courier ?? ''
    }
    if (!courierName) {
      courierName = driverReturnRows.find(
        (r) => norm(r.driverCode) === courierCode && norm(r.driverVendorCode) === vendorCode,
      )?.driverName ?? ''
    }
    if (!courierName) {
      courierName = longTailOrders.find(
        (o) => o.driverCode === courierCode && norm(o.driverVendorCode) === vendorCode,
      )?.driverName ?? courierCode
    }

    const totalDispatch = dispatch?.total ?? 0
    const dispatch24hCount = dispatch?.completed ?? 0

    drivers.push({
      courierCode,
      courierName,
      routeCode: pickup?.routeCode || dispatch?.routeCode || '',
      ofdCount: pickup?.count ?? 0,
      ofdWaybillNos: pickup?.waybillNos ?? [],
      before11OfdCount: pickup?.before11Count ?? 0,
      before11UnmetWaybillNos: pickup?.before11UnmetWaybillNos ?? [],
      returnWarningCount: returnWarningByDriver.get(courierCode)?.count ?? 0,
      returnWarningWaybillNos: returnWarningByDriver.get(courierCode)?.waybillNos ?? [],
      dispatch24hCount,
      totalDispatchCount: totalDispatch,
      dispatchRate24h: totalDispatch > 0 ? dispatch24hCount / totalDispatch : null,
      dispatch24hUnmetWaybillNos: dispatch?.unmetNos ?? [],
      longTailCount: longTailByDriver.get(courierCode)?.count ?? 0,
      longTailWaybillNos: longTailByDriver.get(courierCode)?.waybillNos ?? [],
    })
  }

  drivers.sort((a, b) => b.returnWarningCount - a.returnWarningCount || b.ofdCount - a.ofdCount)
  return drivers
}
