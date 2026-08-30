/**
 * 供应商数据分析——把 worker 抓到的原始明细行聚合成「汇总结果」的纯函数。
 *
 * 由 vendorAnalyzeHandler 在任务完成时调用，产出的 VendorAnalyzeSummary 直接落库，
 * 前端不再持有原始明细、也不再在浏览器现算。聚合口径与旧前端 useVendorAnalysisPage
 * 里的 indexedData / vendorMetrics / driverPerformanceByVendor 逐条对齐。
 *
 * 关键约定：
 * - 结果按「供应商单位」(supplierKey = vendorCode::展示名) 组织，不是按 vendorCode：
 *   ADL-City 和 ADL-Lu 共用 vendorCode，业务上是两家，靠各自负责的路由码分开，不能合并统计。
 *   归属判定统一走 supplierScope 的 SupplierUnitIndex，与告警/司机地图共用同一套。
 * - 客诉量 / 未处理工单这两个数据源只有供应商编码、没有路由码，无法按单位拆分：
 *   同编码的各单位都取该编码的全量值，并置 sharedVendorCode=true 供前端标注「未按路由码拆分」。
 *   长尾单 / 归班预警虽然也没有路由码，但带 driverCode，改由司机归属拆分（见 buildDriverUnitMap）。
 * - 站点口径来自任务的 stationCodes（冻结），不再随查看时的全局筛选变化。
 * - 24H 内比较、归班 48h、"现在"均为绝对时刻，与时区无关；仅「到件日的星期判断」和「周五~日到件批次
 *   的下周一 23:59:59 截止」依赖 targetTz。nowMs = worker 完成时刻。
 */
import { iMileStrToMs, type AusTz } from '../imile/ausTimezone'
import type { SlimPickupRow } from '../imile/vendorAnalysis'
import {
  aggregateDispatch24hByScopes,
  resolveDispatch24hWindowRule,
  type Dispatch24hDriverStat,
} from './dispatch24hAggregate'
import { aggregateBefore11ByScopes } from './before11Aggregate'
import { supplierUnitsToScopes, type SupplierUnitIndex } from './supplierScope'

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
  /** 11点前出仓运单：全量原始打标行；出仓率/未出仓单号的白名单过滤与投影在本文件业务层实现 */
  driverYesterdayWaybills: SlimPickupRow[]
  driverDayBeforeWaybills: DriverWaybillRow[]
  /** driverDayBeforeWaybills 对应的到件日（YYYY-MM-DD）——24H 派签窗口规则按它判定 */
  dayBeforeDate: string
  driverReturnRows: DriverReturnRow[]
  stationCodes: string[]
  tz: AusTz
  /** worker 完成时刻，用作归班预警 48h 的基准 */
  nowMs: number
  /** 供应商单位索引：统计主键与归属判定的唯一来源（由供应商配置构建，随任务 payload 冻结） */
  supplierUnits: SupplierUnitIndex
}

// ── 输出汇总类型（前端 vendorAnalysisSummary.ts 镜像同一结构） ──

export type DriverSummary = {
  courierCode: string
  courierName: string
  routeCode: string
  ofdCount: number
  ofdWaybillNos: string[]
  /** 11点前出率分母：过滤白名单/纳入后的取件数（≠ ofdCount，出率 = before11OfdCount / before11TotalCount） */
  before11TotalCount: number
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
  /** 统计主键：vendorCode::展示名。同编码不同路由码的两家（ADL-City / ADL-Lu）各占一行 */
  supplierKey: string
  supplierName: string
  vendorCode: string
  /**
   * 该 vendorCode 是否被多个供应商单位共用。
   * true 时 complaintCount / unprocessedTicketCount / complaintRate 取的是整个编码的全量值
   * （数据源无路由码，拆不开），前端需标注「未按路由码拆分」，且多家相加会重复计数。
   */
  sharedVendorCode: boolean
  complaintCount: number
  /** 本单位的揽收量（按路由码拆分） */
  waybillCount: number
  /** 客诉率 = 该编码全量客诉 ÷ 该编码全量揽收；分子无法按路由码拆，故分母也用全量，保证口径一致 */
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

export function aggregateVendorAnalysis(input: VendorAnalyzeAggregateInput): VendorSummary[] {
  const {
    tickets,
    waybills,
    unprocessedTickets,
    longTailOrders,
    driverYesterdayWaybills,
    driverDayBeforeWaybills,
    dayBeforeDate,
    driverReturnRows,
    stationCodes,
    tz,
    nowMs,
    supplierUnits,
  } = input

  const stationSet = new Set(stationCodes.map((s) => s.trim()).filter(Boolean))
  const inStation = (code: string | undefined) => stationSet.size === 0 || stationSet.has(norm(code))

  // 同一 vendorCode 下有几个单位：>1 时客诉/工单这类无路由码的指标拆不开，只能给全量值并标注
  const unitCountByVendorCode = new Map<string, number>()
  for (const unit of supplierUnits.units.values()) {
    unitCountByVendorCode.set(unit.vendorCode, (unitCountByVendorCode.get(unit.vendorCode) ?? 0) + 1)
  }
  // 司机 → 供应商单位：长尾单/归班预警只有 driverCode 没有路由码，靠司机归属落到正确的那一家
  const unitByDriver = buildDriverUnitMap(supplierUnits, [driverYesterdayWaybills, driverDayBeforeWaybills])

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

  // 客诉率分母（揽收量）刻意不做路由白名单剔除：分子（客诉量）本就不按白名单过滤，
  // 分母若剔除白名单路由会让两者口径不一致、虚高客诉率。白名单只作用于 24H派签 / 11点前出仓。
  // 两份口径：按编码的全量用于算客诉率（分子拆不开，分母也不能拆），按单位的用于展示揽收量。
  const waybillCountByVendorCode = new Map<string, number>()
  const waybillCountByUnit = new Map<string, number>()
  for (const w of waybills) {
    const vendorCode = norm(w.courierVendorCode)
    waybillCountByVendorCode.set(vendorCode, (waybillCountByVendorCode.get(vendorCode) ?? 0) + 1)
    // 揽收量不剔除白名单：与分子（客诉量，本就不按白名单过滤）保持同一口径
    for (const key of supplierUnits.resolveIgnoringWhitelist(w.courierVendorCode, w.consigneeRouteCode)) {
      waybillCountByUnit.set(key, (waybillCountByUnit.get(key) ?? 0) + 1)
    }
  }

  // 长尾单：无路由码，按司机归属落到具体单位；司机归属不明时退回该编码的唯一单位
  const longTailCountByUnit = new Map<string, number>()
  for (const o of longTailOrders) {
    const key = resolveUnitForDriver(supplierUnits, unitByDriver, o.driverCode, o.driverVendorCode)
    if (!key) continue
    longTailCountByUnit.set(key, (longTailCountByUnit.get(key) ?? 0) + 1)
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

  // 24H派签率 & 11点前出仓率：都用逐范围聚合器，按供应商单位分桶——与两个告警走的是同一套聚合器
  // 和同一套归属判定（vendorCode 归属 → routeCode 纳入 → 白名单剔除），只是 key 换成 supplierKey。
  const unitScopes = supplierUnitsToScopes(supplierUnits)
  // 24H 派签窗口规则按「到件日」定；driverDayBeforeWaybills 拉的就是 dayBeforeDate 那天的到件批次
  const dispatch24hByUnit = aggregateDispatch24hByScopes({
    rows: driverDayBeforeWaybills,
    stationCodes,
    rule: resolveDispatch24hWindowRule(dayBeforeDate, tz),
    scopes: unitScopes,
  })
  const before11ByUnit = aggregateBefore11ByScopes({ rows: driverYesterdayWaybills, scopes: unitScopes })

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

  // 每个已配置的供应商单位出一行（本次无数据的补 0，与前端「已配置但无数据」的展示行为一致）
  const summaries: VendorSummary[] = []
  for (const unit of supplierUnits.units.values()) {
    const { supplierKey, supplierName, vendorCode } = unit
    const drivers = buildDriverSummaries(
      unit,
      input,
      supplierUnits,
      unitByDriver,
      returnWarningByDriver,
      dispatch24hByUnit.get(supplierKey)?.drivers ?? [],
    )

    // 客诉 / 未处理工单：数据源只有供应商编码、没有路由码，同编码多单位时拆不开，各单位都取全量值
    const sharedVendorCode = (unitCountByVendorCode.get(vendorCode) ?? 0) > 1
    const complaint = complaintByVendor.get(vendorCode)
    const complaintCount = complaint?.count ?? 0
    const complaintDenominator = waybillCountByVendorCode.get(vendorCode) ?? 0

    const dispatch = dispatch24hByUnit.get(supplierKey)
    const before11 = before11ByUnit.get(supplierKey)
    const before11Pending = before11
      ? Object.values(before11.zoneBreakdown).reduce((sum, zone) => sum + zone.pending, 0)
      : 0
    const before11ExitVolume = before11 ? before11.totalWaybills - before11Pending : null

    summaries.push({
      supplierKey,
      supplierName,
      vendorCode,
      sharedVendorCode,
      complaintCount,
      waybillCount: waybillCountByUnit.get(supplierKey) ?? 0,
      complaintRate: complaintDenominator > 0 ? complaintCount / complaintDenominator : 0,
      complaintOrderCodes: complaint?.orderCodes ?? [],
      unprocessedTicketCount: unprocessedByVendor.get(vendorCode)?.count ?? 0,
      unprocessedTicketOrderCodes: unprocessedByVendor.get(vendorCode)?.orderCodes ?? [],
      longTailCount: longTailCountByUnit.get(supplierKey) ?? 0,
      before11ExitRate:
        before11 && before11.totalWaybills > 0 ? (before11ExitVolume ?? 0) / before11.totalWaybills : null,
      before11ExitVolume,
      before11TotalReceived: before11?.totalWaybills ?? null,
      before11UnmetWaybillNos: before11?.unqualifiedWaybillNos ?? [],
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

/**
 * 司机 → 供应商单位。长尾单、归班预警只有 driverCode / vendorCode，没有路由码，
 * 靠带路由码的运单数据（昨日取件 + 前天派签）推出每个司机实际属于哪个单位；
 * 司机跨两家跑单时归给运单数多的那家。
 */
function buildDriverUnitMap(
  supplierUnits: SupplierUnitIndex,
  rowGroups: Array<Array<{ courierCode?: string; courierVendorCode?: string; consigneeRouteCode?: string }>>,
): Map<string, string> {
  const countsByDriver = new Map<string, Map<string, number>>()
  for (const rows of rowGroups) {
    for (const row of rows) {
      const driverCode = norm(row.courierCode)
      if (!driverCode) continue
      // 司机属于哪家与白名单无关：白名单只是「这批路由的数据不参与考核」，不改变司机归属
      for (const supplierKey of supplierUnits.resolveIgnoringWhitelist(row.courierVendorCode, row.consigneeRouteCode)) {
        let counts = countsByDriver.get(driverCode)
        if (!counts) { counts = new Map(); countsByDriver.set(driverCode, counts) }
        counts.set(supplierKey, (counts.get(supplierKey) ?? 0) + 1)
      }
    }
  }

  const unitByDriver = new Map<string, string>()
  for (const [driverCode, counts] of countsByDriver) {
    let bestKey = ''
    let bestCount = -1
    // 并列时按 supplierKey 字典序取定，保证同一批数据每次跑出的归属一致
    for (const [supplierKey, count] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (count > bestCount) { bestKey = supplierKey; bestCount = count }
    }
    if (bestKey) unitByDriver.set(driverCode, bestKey)
  }
  return unitByDriver
}

/**
 * 无路由码的行（长尾单 / 归班预警）落到哪个单位：优先按司机归属；
 * 司机在本次数据里没跑过单时，只有当该编码下唯一一个单位时才敢归属，否则宁可不计（不猜）。
 */
function resolveUnitForDriver(
  supplierUnits: SupplierUnitIndex,
  unitByDriver: Map<string, string>,
  driverCode: unknown,
  vendorCode: unknown,
): string | null {
  const byDriver = unitByDriver.get(norm(driverCode))
  if (byDriver) return byDriver
  const code = norm(vendorCode)
  if (!code) return null
  const candidates = [...supplierUnits.units.values()].filter((unit) => unit.vendorCode === code)
  return candidates.length === 1 ? candidates[0]!.supplierKey : null
}

/**
 * 某供应商下的司机绩效行：合并取件 + 24H派签 + 归班预警 + 长尾 四个来源。
 * 24H 派签司机维度直接消费 aggregateDispatch24hByVendor 的 drivers 输出，
 * 不再重抄过滤条件——口径一致由代码保证，而非注释约定。
 */
function buildDriverSummaries(
  unit: { supplierKey: string; vendorCode: string },
  input: VendorAnalyzeAggregateInput,
  supplierUnits: SupplierUnitIndex,
  unitByDriver: Map<string, string>,
  returnWarningByDriver: Map<string, { count: number; waybillNos: string[] }>,
  dispatchDrivers: Dispatch24hDriverStat[],
): DriverSummary[] {
  const { driverYesterdayWaybills, longTailOrders, driverReturnRows } = input
  const { supplierKey } = unit
  /** 无路由码的行（长尾/归班）是否属于本单位：按司机归属判定 */
  const belongsToUnit = (driverCode: unknown, vendorCode: unknown): boolean =>
    resolveUnitForDriver(supplierUnits, unitByDriver, driverCode, vendorCode) === supplierKey

  // 今日取件量(count)按全量统计；11点前出率的分子(before11Count)/分母(before11Total)/未出仓单号
  // 属于「11点前出仓」口径，只统计过滤白名单/纳入后的行。driverYesterdayWaybills 是全量原始打标行。
  type PickupAgg = { courierName: string; routeCode: string; count: number; before11Total: number; before11Count: number; waybillNos: string[]; before11UnmetWaybillNos: string[] }
  const pickupMap = new Map<string, PickupAgg>()
  for (const row of driverYesterdayWaybills) {
    if (!row.courierCode) continue
    // 取件量按「该司机属于本单位」统计；11点前出仓的分子分母另按运单自身的路由码归属收窄
    if (unitByDriver.get(norm(row.courierCode)) !== supplierKey) continue
    const wbNo = row.waybillNo ?? ''
    const scoped = supplierUnits.resolve(row.courierVendorCode, row.consigneeRouteCode).includes(supplierKey)
    let agg = pickupMap.get(row.courierCode)
    if (!agg) {
      agg = { courierName: row.courier ?? '', routeCode: row.consigneeRouteCode ?? '', count: 0, before11Total: 0, before11Count: 0, waybillNos: [], before11UnmetWaybillNos: [] }
      pickupMap.set(row.courierCode, agg)
    }
    agg.count += 1
    if (wbNo) agg.waybillNos.push(wbNo)
    if (scoped) {
      agg.before11Total += 1
      if (row.before11Exit) agg.before11Count += 1
      else if (wbNo) agg.before11UnmetWaybillNos.push(wbNo)
    }
  }

  // 24H派签率：直接消费共享聚合器的司机维度输出（过滤口径唯一实现在 aggregateDispatch24hByVendor）
  const dispatchByCourier = new Map(dispatchDrivers.map((d) => [d.courierCode, d]))

  // 长尾单：按司机 driverCode 聚合（与当前供应商匹配）
  type LongTailAgg = { count: number; waybillNos: string[] }
  const longTailByDriver = new Map<string, LongTailAgg>()
  for (const order of longTailOrders) {
    if (!order.driverCode || !belongsToUnit(order.driverCode, order.driverVendorCode)) continue
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
    ...dispatchByCourier.keys(),
    ...longTailByDriver.keys(),
    ...[...returnWarningByDriver.keys()].filter((code) =>
      driverReturnRows.some((r) => norm(r.driverCode) === code && belongsToUnit(r.driverCode, r.driverVendorCode)),
    ),
  ])

  const drivers: DriverSummary[] = []
  for (const courierCode of allCourierCodes) {
    const pickup = pickupMap.get(courierCode)
    const dispatch = dispatchByCourier.get(courierCode)

    let courierName = pickup?.courierName ?? ''
    if (!courierName && dispatch && dispatch.courierName !== dispatch.courierCode) {
      courierName = dispatch.courierName
    }
    if (!courierName) {
      courierName = driverReturnRows.find(
        (r) => norm(r.driverCode) === courierCode && belongsToUnit(r.driverCode, r.driverVendorCode),
      )?.driverName ?? ''
    }
    if (!courierName) {
      courierName = longTailOrders.find(
        (o) => o.driverCode === courierCode && belongsToUnit(o.driverCode, o.driverVendorCode),
      )?.driverName ?? courierCode
    }

    const totalDispatch = dispatch?.total ?? 0
    const dispatch24hCount = dispatch?.met ?? 0

    drivers.push({
      courierCode,
      courierName,
      routeCode: pickup?.routeCode || dispatch?.routeCode || '',
      ofdCount: pickup?.count ?? 0,
      ofdWaybillNos: pickup?.waybillNos ?? [],
      before11TotalCount: pickup?.before11Total ?? 0,
      before11OfdCount: pickup?.before11Count ?? 0,
      before11UnmetWaybillNos: pickup?.before11UnmetWaybillNos ?? [],
      returnWarningCount: returnWarningByDriver.get(courierCode)?.count ?? 0,
      returnWarningWaybillNos: returnWarningByDriver.get(courierCode)?.waybillNos ?? [],
      dispatch24hCount,
      totalDispatchCount: totalDispatch,
      dispatchRate24h: totalDispatch > 0 ? dispatch24hCount / totalDispatch : null,
      dispatch24hUnmetWaybillNos: dispatch
        ? [...dispatch.neverSignedWaybills, ...dispatch.lateSignedWaybills].map((w) => w.waybillNo)
        : [],
      longTailCount: longTailByDriver.get(courierCode)?.count ?? 0,
      longTailWaybillNos: longTailByDriver.get(courierCode)?.waybillNos ?? [],
    })
  }

  drivers.sort((a, b) => b.returnWarningCount - a.returnWarningCount || b.ofdCount - a.ofdCount)
  return drivers
}
