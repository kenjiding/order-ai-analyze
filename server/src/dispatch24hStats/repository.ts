/**
 * 出仓派签达成分析的落库与查询。
 *
 * 表里只有最细粒度格子，供应商层/路由码层在这里 SUM 出来——所有百分比都由四象限导出，
 * 不在库里冗余存 rate，避免「存的率」和「重算的率」哪天对不上。
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { DispatchPerformanceCell } from './aggregateCells'
import type { DispatchProfitDailyRow } from '../../../shared/dispatchPerformance/profitTrendAggregate'

/** 日度指标保留天数：日度表体积很小，留半年支撑趋势对比 */
export const DISPATCH_PERFORMANCE_RETENTION_DAYS = 180

const UPSERT_CHUNK_SIZE = 500

/**
 * 每个司机每类问题最多回传多少个运单号。
 *
 * 这四个数组是按格子存的 JSONB，跨 62 天累加后单个司机可能上万条，而前端只在展开该司机行时
 * 才用得到。不封顶时整份响应能到几十 MB，浏览器直接卡死。数量由 *Count 字段单独给出，
 * 截断只影响明细列表的可见条数。
 */
const MAX_WAYBILL_NOS_PER_DRIVER = 500

export type DispatchPerformanceQuadrant = {
  exitMetSignMet: number
  exitMetSignUnmet: number
  exitUnmetSignMet: number
  exitUnmetSignUnmet: number
}

export type DispatchPerformanceMetrics = {
  total: number
  /** 11点前出仓达标数；出仓那一趟就已确定 */
  before11Met: number
  /** 24H 派签达标数 = exitMetSignMet + exitUnmetSignMet；未结算时为 0 且 signRate 为 null */
  signMet: number
  /** 百分比，0~100 保留两位；total=0 时为 null（无数据不是 0%） */
  before11Rate: number | null
  /** 派签率；**派签尚未结算时为 null**，前端必须显示「结算中」而不是 0% */
  signRate: number | null
  /** 出仓率 - 派签率，两个指标的落差；任一为 null 时为 null */
  rateGap: number | null
  /**
   * 该聚合范围内派签是否已全部结算。
   * 跨天查询时若混了「已结算」和「结算中」的到件日，取 false —— 宁可显示结算中，
   * 也不能把只算了一半的批次当成完整数据摆出来。
   */
  dispatchSettled: boolean
  /** 当天出仓（到件日 D 23:59:59 前）达标数与率；出仓那一趟就已确定 */
  sameDayExitMet: number
  sameDayExitRate: number | null
  /** 次日派签（出仓日 O 23:59:59 前完成）达标数与率；率在派签未结算时为 null */
  nextDaySignMet: number
  nextDaySignRate: number | null
  /** 优先件数与其次日完成率；率在派签未结算或无优先件时为 null */
  priorityTotal: number
  priorityNextDaySignMet: number
  priorityNextDaySignRate: number | null
  /**
   * 「出仓准点 × 次日派签」交叉格。前端据此把未达成拆成两段（见 schema 注释的减法）：
   * 出仓准点却没派掉 = 司机/负载问题；出仓就晚了 = 分拣出仓问题。
   */
  exitMetNextDaySignMet: number
  /** 优先件的出仓达标数与交叉格，口径同上但分母是 priorityTotal */
  priorityBefore11Met: number
  priorityExitMetNextDaySignMet: number
  problemCount: number
  neverSignedCount: number
  lateSignedCount: number
  /**
   * 供应商利润 Σ(price - courierPrice) / 司机利润 Σ courierPrice。
   * 只统计**签收成功**的包裹，单价按运单 postcode + suburb 查 region_package_prices。
   * 与 signRate 不同：金额恒为数值，给出的是**截至已结算日**累计的钱（未结算日金额本就是 0）。
   * 区间是否完整看 dispatchSettled。
   */
  vendorProfit: number
  courierProfit: number
  /** 签收且匹配到价格的件数 */
  pricedSignedCount: number
  /** 签收但没匹配到价格的件数：这些单没计钱，页面要显式标出来 */
  unpricedSignedCount: number
  quadrant: DispatchPerformanceQuadrant
}

export type DispatchPerformanceDriverNode = DispatchPerformanceMetrics & {
  courierCode: string
  courierName: string
  neverSignedWaybillNos: string[]
  lateSignedWaybillNos: string[]
  problemWaybillNos: string[]
  before11UnmetWaybillNos: string[]
}

export type DispatchPerformanceRouteNode = DispatchPerformanceMetrics & {
  routeCode: string
  /**
   * 本行 total 里有多少单落在路由码白名单上。仅用于标记，不改变本行任何数字。
   * 「剔除白名单」口径下这些行压根不在结果里，所以它恒为 0；「全量」口径下它 > 0
   * 就是在告诉用户这条路由本不参与考核。
   *
   * 用数量而不是布尔：区间跨多天时，同一条路由可能前几天还在考核、后几天才被加进白名单，
   * 一个布尔只能记住碰到的第一天，会给出忽真忽假的标记。
   */
  whitelistTotal: number
  drivers: DispatchPerformanceDriverNode[]
}

export type DispatchPerformanceSupplierNode = DispatchPerformanceMetrics & {
  supplierKey: string
  supplierName: string
  vendorCode: string
  routes: DispatchPerformanceRouteNode[]
}

export type DispatchPerformanceQueryResult = {
  stationCode: string
  startDate: string
  endDate: string
  /** 区间内实际有数据的到件日（升序），供前端提示哪些天尚未结算 */
  arrivalDates: string[]
  overall: DispatchPerformanceMetrics
  /**
   * 全站白名单单量。「剔除白名单」口径下 = 被剔掉了多少单（不在 overall 里）；
   * 「全量」口径下 = overall 里含了多少单白名单。两种口径都靠它告诉用户差在哪。
   */
  whitelistTotal: number
  suppliers: DispatchPerformanceSupplierNode[]
}

function rate(numerator: number, total: number): number | null {
  if (total <= 0) return null
  return Math.round((numerator / total) * 10000) / 100
}

/** 可累加的中间态：先把格子按维度加起来，最后统一算率 */
type Acc = {
  total: number
  before11Met: number
  exitMetSignMet: number
  exitMetSignUnmet: number
  exitUnmetSignMet: number
  exitUnmetSignUnmet: number
  sameDayExitMet: number
  nextDaySignMet: number
  priorityTotal: number
  priorityNextDaySignMet: number
  exitMetNextDaySignMet: number
  priorityBefore11Met: number
  priorityExitMetNextDaySignMet: number
  problemCount: number
  neverSignedCount: number
  lateSignedCount: number
  /** 供应商利润 Σ(price - courierPrice)，只含签收成功且匹配到价格的包裹 */
  vendorProfit: number
  /** 司机利润 Σ courierPrice，口径同上 */
  courierProfit: number
  pricedSignedCount: number
  /** 签收但没匹配到区域价格的件数：一分钱没算进去，页面要标出来 */
  unpricedSignedCount: number
  /** 累加范围内是否每一行的派签都已结算；只要混进一行未结算就为 false */
  dispatchSettled: boolean
}

function newAcc(): Acc {
  return {
    total: 0,
    before11Met: 0,
    exitMetSignMet: 0,
    exitMetSignUnmet: 0,
    exitUnmetSignMet: 0,
    exitUnmetSignUnmet: 0,
    sameDayExitMet: 0,
    nextDaySignMet: 0,
    priorityTotal: 0,
    priorityNextDaySignMet: 0,
    exitMetNextDaySignMet: 0,
    priorityBefore11Met: 0,
    priorityExitMetNextDaySignMet: 0,
    problemCount: 0,
    neverSignedCount: 0,
    lateSignedCount: 0,
    vendorProfit: 0,
    courierProfit: 0,
    pricedSignedCount: 0,
    unpricedSignedCount: 0,
    dispatchSettled: true,
  }
}

function addToAcc(acc: Acc, row: Omit<Acc, 'dispatchSettled'> & { dispatchSettled: boolean }): void {
  acc.total += row.total
  acc.before11Met += row.before11Met
  acc.exitMetSignMet += row.exitMetSignMet
  acc.exitMetSignUnmet += row.exitMetSignUnmet
  acc.exitUnmetSignMet += row.exitUnmetSignMet
  acc.exitUnmetSignUnmet += row.exitUnmetSignUnmet
  acc.sameDayExitMet += row.sameDayExitMet
  acc.nextDaySignMet += row.nextDaySignMet
  acc.priorityTotal += row.priorityTotal
  acc.priorityNextDaySignMet += row.priorityNextDaySignMet
  acc.exitMetNextDaySignMet += row.exitMetNextDaySignMet
  acc.priorityBefore11Met += row.priorityBefore11Met
  acc.priorityExitMetNextDaySignMet += row.priorityExitMetNextDaySignMet
  acc.problemCount += row.problemCount
  acc.neverSignedCount += row.neverSignedCount
  acc.lateSignedCount += row.lateSignedCount
  acc.vendorProfit += row.vendorProfit
  acc.courierProfit += row.courierProfit
  acc.pricedSignedCount += row.pricedSignedCount
  acc.unpricedSignedCount += row.unpricedSignedCount
  acc.dispatchSettled &&= row.dispatchSettled
}

/** 金额保留两位小数，避免浮点累加尾巴透到接口上 */
function money(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 累加结果 → 对外指标。
 * 出仓率任何时候都能算；派签率只在该范围内全部结算后才有意义，否则给 null（前端显示「结算中」）。
 */
export function toMetrics(acc: Acc): DispatchPerformanceMetrics {
  const signMet = acc.exitMetSignMet + acc.exitUnmetSignMet
  const before11Rate = rate(acc.before11Met, acc.total)
  const signRate = acc.dispatchSettled ? rate(signMet, acc.total) : null
  return {
    total: acc.total,
    before11Met: acc.before11Met,
    signMet,
    before11Rate,
    signRate,
    rateGap:
      before11Rate == null || signRate == null
        ? null
        : Math.round((before11Rate - signRate) * 100) / 100,
    dispatchSettled: acc.dispatchSettled,
    sameDayExitMet: acc.sameDayExitMet,
    sameDayExitRate: rate(acc.sameDayExitMet, acc.total),
    nextDaySignMet: acc.nextDaySignMet,
    nextDaySignRate: acc.dispatchSettled ? rate(acc.nextDaySignMet, acc.total) : null,
    priorityTotal: acc.priorityTotal,
    priorityNextDaySignMet: acc.priorityNextDaySignMet,
    priorityNextDaySignRate: acc.dispatchSettled
      ? rate(acc.priorityNextDaySignMet, acc.priorityTotal)
      : null,
    exitMetNextDaySignMet: acc.exitMetNextDaySignMet,
    priorityBefore11Met: acc.priorityBefore11Met,
    priorityExitMetNextDaySignMet: acc.priorityExitMetNextDaySignMet,
    problemCount: acc.problemCount,
    neverSignedCount: acc.neverSignedCount,
    lateSignedCount: acc.lateSignedCount,
    /**
     * 金额**不跟 signRate 那套 null 规矩**：率是比例，混进未结算的日子就没意义；
     * 钱是可加的，已结算那些天赚到的钱是确定的。未结算日的金额本来就是 0
     * （出仓趟不算钱），直接累加得到的就是「截至已结算日的钱」。
     *
     * 跟着 signRate 给 null 的话，只要区间里混一天没结算，整段金额就全成「结算中」——
     * 而详情页默认区间的最后一天（昨天）派签必然还没结算，等于永远看不到钱。
     * 区间是否完整由 dispatchSettled 与 pricedSignedCount 告诉前端，不靠把金额抹掉来表达。
     */
    vendorProfit: money(acc.vendorProfit),
    courierProfit: money(acc.courierProfit),
    pricedSignedCount: acc.pricedSignedCount,
    unpricedSignedCount: acc.unpricedSignedCount,
    quadrant: {
      exitMetSignMet: acc.exitMetSignMet,
      exitMetSignUnmet: acc.exitMetSignUnmet,
      exitUnmetSignMet: acc.exitUnmetSignMet,
      exitUnmetSignUnmet: acc.exitUnmetSignUnmet,
    },
  }
}

/** 结算阶段：出仓（D+1）只填出仓列，派签（D+2）完整重算并填四象限 */
export type SettleStage = 'exit' | 'dispatch'

export type SaveCellsInput = {
  arrivalDate: string
  stationCode: string
  stage: SettleStage
  cells: DispatchPerformanceCell[]
  /** supplierKey → { supplierName, vendorCode }，用于把展示信息一并落库 */
  supplierMeta: Map<string, { supplierName: string; vendorCode: string }>
  /** 本次从 iMile 拉到的运单数，写进台账供排查「这天为什么没数据」 */
  waybillCount: number
  /**
   * 临时值：数据照常落库，但**不在台账上标记派签那一趟跑过了**，好让到点的定时结算
   * 到点再跑一次、把它覆盖成权威值。手动「立刻统计」的派签趟用它。
   *
   * 为什么仍标记出仓那一趟：派签趟重算出来的出仓数据本身是准确的（出仓阈值是硬时间点，
   * 过了就定死），标记后出仓趟不会再跑来把派签结果清成 0。
   */
  provisional?: boolean
}

/**
 * 覆盖式写入某 (station, arrivalDate) 的全部格子：先删后插，并在台账上记下这一趟跑过了。
 *
 * 不用 upsert 的原因：重算时供应商配置可能已经变化（路由码调整、司机换人），
 * 上一次留下的格子不会出现在本次结果里，upsert 无法把它们清掉，会留下永远不再更新的幽灵行。
 *
 * 派签那一趟（stage='dispatch'）同样整体覆盖出仓趟的结果——两趟拉的是同一批单，
 * 中间可能又有包裹被派出（出仓趟时还没司机），完整重算才能让格子网格与最终状态一致。
 *
 * 台账与格子在同一事务里写：跑完但没数据（不分拣的工作日）也要留下台账行，
 * 否则「有没有行」判重会让这天每天被重新拉一遍。
 */
export async function saveDispatchPerformanceCells(input: SaveCellsInput): Promise<number> {
  const { arrivalDate, stationCode, stage, cells, supplierMeta, waybillCount, provisional } = input
  const db = getDb()
  const t = schema.dispatchPerformanceDailyStats
  const ledger = schema.dispatchPerformanceSettledBatches
  const now = new Date()

  const values: (typeof t.$inferInsert)[] = cells.map((cell) => {
    const meta = supplierMeta.get(cell.scopeKey)
    return {
      arrivalDate,
      stationCode,
      supplierKey: cell.scopeKey,
      vendorCode: meta?.vendorCode ?? '',
      supplierName: meta?.supplierName ?? cell.scopeKey,
      routeCode: cell.routeCode,
      isWhitelist: cell.isWhitelist,
      courierCode: cell.courierCode,
      courierName: cell.courierName,
      total: cell.total,
      before11Met: cell.before11Met,
      dispatchSettled: cell.dispatchSettled,
      exitMetSignMet: cell.exitMetSignMet,
      exitMetSignUnmet: cell.exitMetSignUnmet,
      exitUnmetSignMet: cell.exitUnmetSignMet,
      exitUnmetSignUnmet: cell.exitUnmetSignUnmet,
      sameDayExitMet: cell.sameDayExitMet,
      nextDaySignMet: cell.nextDaySignMet,
      priorityTotal: cell.priorityTotal,
      priorityNextDaySignMet: cell.priorityNextDaySignMet,
      exitMetNextDaySignMet: cell.exitMetNextDaySignMet,
      priorityBefore11Met: cell.priorityBefore11Met,
      priorityExitMetNextDaySignMet: cell.priorityExitMetNextDaySignMet,
      problemCount: cell.problemCount,
      neverSignedCount: cell.neverSignedCount,
      lateSignedCount: cell.lateSignedCount,
      vendorProfit: cell.vendorProfit,
      courierProfit: cell.courierProfit,
      pricedSignedCount: cell.pricedSignedCount,
      unpricedSignedCount: cell.unpricedSignedCount,
      neverSignedWaybillNos: cell.neverSignedWaybillNos,
      lateSignedWaybillNos: cell.lateSignedWaybillNos,
      problemWaybillNos: cell.problemWaybillNos,
      before11UnmetWaybillNos: cell.before11UnmetWaybillNos,
      computedAt: now,
      createdAt: now,
      updatedAt: now,
    }
  })

  // 临时落库的派签趟按出仓趟的方式盖章：出仓算准了、就此定死，派签留 null 等定时任务覆盖
  const stageStamp =
    stage === 'exit' || provisional
      ? { exitSettledAt: now }
      : { exitSettledAt: now, dispatchSettledAt: now }

  await db.transaction(async (tx) => {
    await tx
      .delete(t)
      .where(and(eq(t.arrivalDate, arrivalDate), eq(t.stationCode, stationCode)))
    for (let i = 0; i < values.length; i += UPSERT_CHUNK_SIZE) {
      await tx.insert(t).values(values.slice(i, i + UPSERT_CHUNK_SIZE))
    }
    await tx
      .insert(ledger)
      .values({
        stationCode,
        arrivalDate,
        ...stageStamp,
        waybillCount,
        cellCount: values.length,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [ledger.stationCode, ledger.arrivalDate],
        set: {
          ...stageStamp,
          waybillCount,
          cellCount: values.length,
          updatedAt: now,
        },
      })
  })

  return values.length
}

/**
 * 台账里已完成某一趟结算的到件日集合。
 *
 * 判重必须看台账而不是日度表有没有行：不分拣的工作日 inbound/query 本就没数据、
 * 聚合出 0 个格子，按「有没有行」判会让这天每天被重新拉一遍直到滑出回看窗口。
 */
export async function listSettledArrivalDates(
  stationCode: string,
  arrivalDates: string[],
  stage: SettleStage,
): Promise<Set<string>> {
  if (arrivalDates.length === 0) return new Set()
  const db = getDb()
  const ledger = schema.dispatchPerformanceSettledBatches
  const stageDone =
    stage === 'exit'
      ? sql`${ledger.exitSettledAt} IS NOT NULL`
      : sql`${ledger.dispatchSettledAt} IS NOT NULL`
  const rows = await db
    .select({ arrivalDate: ledger.arrivalDate })
    .from(ledger)
    .where(
      and(
        eq(ledger.stationCode, stationCode),
        inArray(ledger.arrivalDate, arrivalDates),
        stageDone,
      ),
    )
  return new Set(rows.map((r) => r.arrivalDate))
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

/** 追加运单号，累计到 MAX_WAYBILL_NOS_PER_DRIVER 就停手（见该常量） */
function pushCapped(target: string[], value: unknown): void {
  if (target.length >= MAX_WAYBILL_NOS_PER_DRIVER) return
  for (const no of asStrings(value)) {
    target.push(no)
    if (target.length >= MAX_WAYBILL_NOS_PER_DRIVER) return
  }
}

/**
 * 累加所需的最小行形状：来自日度表，但只声明真正用到的列，
 * 好让 buildDispatchPerformanceTree 能脱离数据库单测。
 */
export type DispatchPerformanceStatRow = Omit<Acc, 'dispatchSettled'> & {
  arrivalDate: string
  supplierKey: string
  supplierName: string
  vendorCode: string
  routeCode: string
  courierCode: string
  courierName: string
  isWhitelist: boolean
  dispatchSettled: boolean
  neverSignedWaybillNos: unknown
  lateSignedWaybillNos: unknown
  problemWaybillNos: unknown
  before11UnmetWaybillNos: unknown
}

/**
 * 把日度格子累加成「站点 → 供应商 → 路由码 → 司机」四层结果。纯函数，不碰数据库。
 *
 * **白名单是一个口径开关，不是逐指标的特例**（`includeWhitelist`）：
 * - `false`（剔除白名单，默认）：白名单格子直接不参与统计 —— 每一层、每一个指标，
 *   单量、率、问题件、优先件、利润一视同仁。被剔掉的单量在 whitelistTotal 里给出。
 * - `true`（全量）：白名单格子照常累加，全部指标都是全量口径。
 *
 * 两个口径各自内部自洽，四层之间可以对得上（Σ路由 = 供应商 = Σ供应商 = 站点）。
 * 早先那套「率剔白名单、钱和优先件不剔」的混合口径已废弃：同一行里两个数用两套分母，
 * 没人解释得清。想看钱含不含白名单，切口径看两次即可。
 */
export function buildDispatchPerformanceTree(
  rows: DispatchPerformanceStatRow[],
  includeWhitelist = false,
): {
  overall: DispatchPerformanceMetrics
  whitelistTotal: number
  suppliers: DispatchPerformanceSupplierNode[]
} {
  type DriverBucket = {
    courierCode: string
    courierName: string
    acc: Acc
    neverSignedWaybillNos: string[]
    lateSignedWaybillNos: string[]
    problemWaybillNos: string[]
    before11UnmetWaybillNos: string[]
  }
  type RouteBucket = {
    routeCode: string
    /** 本路由里的白名单单量，只用于打标记，见 DispatchPerformanceRouteNode.whitelistTotal */
    whitelistTotal: number
    acc: Acc
    drivers: Map<string, DriverBucket>
  }
  type SupplierBucket = {
    supplierKey: string
    supplierName: string
    vendorCode: string
    acc: Acc
    routes: Map<string, RouteBucket>
  }

  const overallAcc = newAcc()
  // 两种口径下都要报这个数：剔除口径下是「剔掉了多少」，全量口径下是「含了多少」
  let overallWhitelistTotal = 0
  const suppliers = new Map<string, SupplierBucket>()

  for (const row of rows) {
    if (row.isWhitelist) {
      overallWhitelistTotal += row.total
      if (!includeWhitelist) continue // 剔除口径：这一格自此完全不存在
    }
    addToAcc(overallAcc, row)

    let supplier = suppliers.get(row.supplierKey)
    if (!supplier) {
      supplier = {
        supplierKey: row.supplierKey,
        supplierName: row.supplierName || row.supplierKey,
        vendorCode: row.vendorCode,
        acc: newAcc(),
        routes: new Map(),
      }
      suppliers.set(row.supplierKey, supplier)
    }
    addToAcc(supplier.acc, row)

    let route = supplier.routes.get(row.routeCode)
    if (!route) {
      route = { routeCode: row.routeCode, whitelistTotal: 0, acc: newAcc(), drivers: new Map() }
      supplier.routes.set(row.routeCode, route)
    }
    if (row.isWhitelist) route.whitelistTotal += row.total
    addToAcc(route.acc, row)

    let driver = route.drivers.get(row.courierCode)
    if (!driver) {
      driver = {
        courierCode: row.courierCode,
        courierName: row.courierName || row.courierCode,
        acc: newAcc(),
        neverSignedWaybillNos: [],
        lateSignedWaybillNos: [],
        problemWaybillNos: [],
        before11UnmetWaybillNos: [],
      }
      route.drivers.set(row.courierCode, driver)
    }
    addToAcc(driver.acc, row)
    pushCapped(driver.neverSignedWaybillNos, row.neverSignedWaybillNos)
    pushCapped(driver.lateSignedWaybillNos, row.lateSignedWaybillNos)
    pushCapped(driver.problemWaybillNos, row.problemWaybillNos)
    pushCapped(driver.before11UnmetWaybillNos, row.before11UnmetWaybillNos)
  }

  // 排序统一按「未达标数从多到少」：分析页要先看到最差的那几家/几条路由/几个司机
  const byUnmet = (a: { acc: Acc }, b: { acc: Acc }) => {
    const unmet = (x: Acc) => x.total - (x.exitMetSignMet + x.exitUnmetSignMet)
    return unmet(b.acc) - unmet(a.acc) || b.acc.total - a.acc.total
  }
  const supplierNodes: DispatchPerformanceSupplierNode[] = [...suppliers.values()]
    .sort(byUnmet)
    .map((supplier) => ({
      supplierKey: supplier.supplierKey,
      supplierName: supplier.supplierName,
      vendorCode: supplier.vendorCode,
      ...toMetrics(supplier.acc),
      routes: [...supplier.routes.values()]
        .sort(byUnmet)
        .map((route) => ({
          routeCode: route.routeCode,
          whitelistTotal: route.whitelistTotal,
          ...toMetrics(route.acc),
          drivers: [...route.drivers.values()]
            .sort(byUnmet)
            .map((driver) => ({
              courierCode: driver.courierCode,
              courierName: driver.courierName,
              ...toMetrics(driver.acc),
              neverSignedWaybillNos: driver.neverSignedWaybillNos,
              lateSignedWaybillNos: driver.lateSignedWaybillNos,
              problemWaybillNos: driver.problemWaybillNos,
              before11UnmetWaybillNos: driver.before11UnmetWaybillNos,
            })),
        })),
    }))

  return {
    overall: toMetrics(overallAcc),
    whitelistTotal: overallWhitelistTotal,
    suppliers: supplierNodes,
  }
}

/**
 * 查询区间内的三层结果。区间跨多天时同一 (supplier, route, courier) 会有多行，按维度累加。
 */
export async function queryDispatchPerformance(params: {
  stationCode: string
  startDate: string
  endDate: string
  supplierKeys?: string[]
  /** 口径开关，见 buildDispatchPerformanceTree；默认剔除白名单 */
  includeWhitelist?: boolean
}): Promise<DispatchPerformanceQueryResult> {
  const { stationCode, startDate, endDate, supplierKeys, includeWhitelist = false } = params
  const db = getDb()
  const t = schema.dispatchPerformanceDailyStats

  const conditions = [
    eq(t.stationCode, stationCode),
    gte(t.arrivalDate, startDate),
    lte(t.arrivalDate, endDate),
  ]
  if (supplierKeys?.length) conditions.push(inArray(t.supplierKey, supplierKeys))

  const rows = await db
    .select()
    .from(t)
    .where(and(...conditions))

  return {
    stationCode,
    startDate,
    endDate,
    // 跟着口径走：剔除白名单时，只有白名单数据的那天就是「这天没数据」
    arrivalDates: [
      ...new Set(rows.filter((r) => includeWhitelist || !r.isWhitelist).map((r) => r.arrivalDate)),
    ].sort(),
    ...buildDispatchPerformanceTree(rows, includeWhitelist),
  }
}

/** 区间内有数据的供应商列表，供前端筛选器用 */
export async function listDispatchPerformanceSuppliers(params: {
  stationCode: string
  startDate: string
  endDate: string
}): Promise<{ supplierKey: string; supplierName: string; vendorCode: string }[]> {
  const db = getDb()
  const t = schema.dispatchPerformanceDailyStats
  const rows = await db
    .selectDistinct({
      supplierKey: t.supplierKey,
      supplierName: t.supplierName,
      vendorCode: t.vendorCode,
    })
    .from(t)
    .where(
      and(
        eq(t.stationCode, params.stationCode),
        gte(t.arrivalDate, params.startDate),
        lte(t.arrivalDate, params.endDate),
      ),
    )
  return rows.sort((a, b) => a.supplierName.localeCompare(b.supplierName))
}

const CELL_KEY_SEP_PROFIT = '::'

/**
 * 利润趋势的原始明细：按 (到件日, 供应商, 路由码, 司机) 出未合桶的行，不跨天合并——
 * 这已经是日度表的最细粒度，只是不揉成树。供应商/路由码/司机三个维度都从这同一份
 * 原始行本地聚合出来（shared/dispatchPerformance/profitTrendAggregate.ts），天/周/月切换、
 * 按 courierCode 全局合并（同一司机可能跨供应商接单）也留给前端本地算，不用分别请求三次接口。
 */
export async function queryDispatchProfitTrend(params: {
  stationCode: string
  startDate: string
  endDate: string
  supplierKeys?: string[]
  includeWhitelist?: boolean
}): Promise<DispatchProfitDailyRow[]> {
  const { stationCode, startDate, endDate, supplierKeys, includeWhitelist = false } = params
  const db = getDb()
  const t = schema.dispatchPerformanceDailyStats

  const conditions = [
    eq(t.stationCode, stationCode),
    gte(t.arrivalDate, startDate),
    lte(t.arrivalDate, endDate),
  ]
  if (supplierKeys?.length) conditions.push(inArray(t.supplierKey, supplierKeys))

  const rows = await db
    .select()
    .from(t)
    .where(and(...conditions))

  const merged = new Map<string, DispatchProfitDailyRow>()
  for (const row of rows) {
    if (row.isWhitelist && !includeWhitelist) continue
    const key = [row.arrivalDate, row.supplierKey, row.routeCode, row.courierCode].join(CELL_KEY_SEP_PROFIT)
    let acc = merged.get(key)
    if (!acc) {
      acc = {
        arrivalDate: row.arrivalDate,
        supplierKey: row.supplierKey,
        supplierName: row.supplierName || row.supplierKey,
        routeCode: row.routeCode,
        courierCode: row.courierCode,
        courierName: row.courierName || row.courierCode,
        vendorProfit: 0,
        courierProfit: 0,
        total: 0,
        pricedSignedCount: 0,
        unpricedSignedCount: 0,
      }
      merged.set(key, acc)
    }
    acc.vendorProfit += row.vendorProfit
    acc.courierProfit += row.courierProfit
    acc.total += row.total
    acc.pricedSignedCount += row.pricedSignedCount
    acc.unpricedSignedCount += row.unpricedSignedCount
  }

  return [...merged.values()]
    .map((r) => ({ ...r, vendorProfit: money(r.vendorProfit), courierProfit: money(r.courierProfit) }))
    .sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate))
}

/** 删除超过保留期的日度指标（按 arrival_date 的字符串比较，格式固定 YYYY-MM-DD 可直接比） */
export async function purgeOldDispatchPerformanceStats(
  keepDays = DISPATCH_PERFORMANCE_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const db = getDb()
  const deleted = await db
    .delete(schema.dispatchPerformanceDailyStats)
    .where(sql`${schema.dispatchPerformanceDailyStats.arrivalDate} < ${cutoff}`)
    .returning({ id: schema.dispatchPerformanceDailyStats.id })
  // 台账跟着一起清：留着也没用（结算不回补），不清就是一张只增不减的表
  await db
    .delete(schema.dispatchPerformanceSettledBatches)
    .where(sql`${schema.dispatchPerformanceSettledBatches.arrivalDate} < ${cutoff}`)
  return deleted.length
}
