/**
 * 出仓派签达成分析的落库与查询。
 *
 * 表里只有最细粒度格子，供应商层/路由码层在这里 SUM 出来——所有百分比都由四象限导出，
 * 不在库里冗余存 rate，避免「存的率」和「重算的率」哪天对不上。
 */
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { FleetSupplierPushConfig } from '../db/schema'
import type { DispatchPerformanceCell } from './aggregateCells'
import type { DispatchProfitDailyRow } from '../../../shared/dispatchPerformance/profitTrendAggregate'
import { listSupplierPushConfigs, parsePushConfigIds } from '../supplierPushConfigs'
import { buildSupplierUnitIndex, type SupplierUnit } from '../vendorAnalysis/supplierScope'

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
   * 异常报备剔除数：从 signRate 的分母里扣掉了多少单（不影响 before11Rate/sameDayExitRate）。
   * 判定依据是「24H 口径未达标」= neverSignedWaybillNos ∪ lateSignedWaybillNos。见 DispatchPerformanceException。
   */
  excludedCount: number
  /**
   * 从 nextDaySignRate 分母里扣掉了多少单。**跟 excludedCount 不是同一个数**——次日截止时间
   * （出仓日 23:59:59）跟 24H 滚动窗口不是同一个口径，同一运单号两边达标与否可能不一致，
   * 判定依据是单独存的 nextDayUnmetWaybillNos，不能直接复用 excludedCount。
   */
  excludedNextDayCount: number
  /** 从 priorityNextDaySignRate 分母里扣掉了多少单，判定依据是 priorityNextDayUnmetWaybillNos */
  excludedPriorityCount: number
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
  /**
   * 该路由码在当前供应商推送配置里实际归属的另一家供应商展示名。
   * 只在「这条路由不在本供应商任何配置名单里、但能在别家名下查到」时才有值——
   * 对应 aggregateCells 的兜底计入场景（如临时借调司机跑了别家的路由）。
   * 按**当前**配置实时算，不随历史落库数据变化；配置改了，这个标记当天就会消失。
   */
  foreignVendorName?: string
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
  /**
   * 异常报备剔除数，见 DispatchPerformanceMetrics 同名字段。三个口径各自独立：
   * excludedSignCount 对应 24H 派签率（判定用 neverSignedWaybillNos ∪ lateSignedWaybillNos），
   * excludedNextDaySignCount 对应次日派签率（判定用 nextDayUnmetWaybillNos，口径不同不能共用）,
   * excludedPriorityNextDaySignCount 对应优先件次日完成率。
   */
  excludedSignCount: number
  excludedNextDaySignCount: number
  excludedPriorityNextDaySignCount: number
  /** 累加范围内是否每一行的派签都已结算；只要混进一行未结算就为 false */
  dispatchSettled: boolean
}

type ExcludedAccKey = 'excludedSignCount' | 'excludedNextDaySignCount' | 'excludedPriorityNextDaySignCount'

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
    excludedSignCount: 0,
    excludedNextDaySignCount: 0,
    excludedPriorityNextDaySignCount: 0,
    dispatchSettled: true,
  }
}

/**
 * 三个 excluded* 字段在 row 上是可选的：纯函数单测（performanceTree.test.ts）构造的格子
 * 不关心异常报备这个维度，只有 queryDispatchPerformance 按自然键关联报备记录后才会填上。
 */
function addToAcc(
  acc: Acc,
  row: Omit<Acc, 'dispatchSettled' | ExcludedAccKey> & {
    dispatchSettled: boolean
    excludedSignCount?: number
    excludedNextDaySignCount?: number
    excludedPriorityNextDaySignCount?: number
  },
): void {
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
  acc.excludedSignCount += row.excludedSignCount ?? 0
  acc.excludedNextDaySignCount += row.excludedNextDaySignCount ?? 0
  acc.excludedPriorityNextDaySignCount += row.excludedPriorityNextDaySignCount ?? 0
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
  /**
   * 派送类指标（signRate/nextDaySignRate/priorityNextDaySignRate）用扣掉异常报备剔除数的分母，
   * 出仓率继续用原始 total——剔除的是「司机侧确实送不了」，不改变货是否已经出仓这件事。
   * 见 DispatchPerformanceException。三个分母各自独立扣减，不能共用同一个剔除数：
   * 24H 窗口和次日窗口（出仓日 23:59:59）截止时间不同，同一运单号两边达标与否可能不一致。
   */
  const signTotal = Math.max(0, acc.total - acc.excludedSignCount)
  const signRate = acc.dispatchSettled ? rate(signMet, signTotal) : null
  const nextDaySignTotal = Math.max(0, acc.total - acc.excludedNextDaySignCount)
  const prioritySignTotal = Math.max(0, acc.priorityTotal - acc.excludedPriorityNextDaySignCount)
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
    excludedCount: acc.excludedSignCount,
    excludedNextDayCount: acc.excludedNextDaySignCount,
    excludedPriorityCount: acc.excludedPriorityNextDaySignCount,
    dispatchSettled: acc.dispatchSettled,
    sameDayExitMet: acc.sameDayExitMet,
    sameDayExitRate: rate(acc.sameDayExitMet, acc.total),
    nextDaySignMet: acc.nextDaySignMet,
    nextDaySignRate: acc.dispatchSettled ? rate(acc.nextDaySignMet, nextDaySignTotal) : null,
    priorityTotal: acc.priorityTotal,
    priorityNextDaySignMet: acc.priorityNextDaySignMet,
    priorityNextDaySignRate: acc.dispatchSettled
      ? rate(acc.priorityNextDaySignMet, prioritySignTotal)
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
   * 临时值：数据照常落库、台账照常盖章（dispatch_settled_at 会被写上），但打上
   * dispatchSettledProvisional 标记——站点自己的定时任务据此识别出这行还没被权威结果覆盖过，
   * 到点仍会重跑一次并转正。手动「立刻统计」的派签趟用它，让用户不用等定时任务也能看到「已结算」，
   * 同时不影响定时任务后续追上来纠正。
   *
   * 为什么出仓那一趟不需要这个标记：派签趟重算出来的出仓数据本身是准确的（出仓阈值是硬时间点，
   * 过了就定死，提前跑与到点跑结论一致），直接盖死即可，不存在「还需要被覆盖」的情况。
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
      priorityNeverSignedWaybillNos: cell.priorityNeverSignedWaybillNos,
      nextDayUnmetWaybillNos: cell.nextDayUnmetWaybillNos,
      priorityNextDayUnmetWaybillNos: cell.priorityNextDayUnmetWaybillNos,
      computedAt: now,
      createdAt: now,
      updatedAt: now,
    }
  })

  // 派签趟同样立刻盖章（不再留 dispatch_settled_at 为 null），只是打上 provisional 标记——
  // 站点自己的定时任务到点后识别出这个标记，把它当「还没被权威结果覆盖」重新跑一次并转正
  const stageStamp =
    stage === 'exit'
      ? { exitSettledAt: now }
      : { exitSettledAt: now, dispatchSettledAt: now, dispatchSettledProvisional: provisional === true }

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
 *
 * `excludeProvisional`：只给站点自己的定时任务用。派签趟被「立刻统计」手动盖过临时章
 * （dispatchSettledProvisional=true）时，定时任务不能把它当「已完成」跳过——那样权威结果
 * 永远没机会覆盖上去。除定时任务外的调用方（手动结算自己的判重、写库前的race复核）都不传，
 * 语义是「有没有盖过章」，不关心是谁盖的。
 */
export async function listSettledArrivalDates(
  stationCode: string,
  arrivalDates: string[],
  stage: SettleStage,
  opts?: { excludeProvisional?: boolean },
): Promise<Set<string>> {
  if (arrivalDates.length === 0) return new Set()
  const db = getDb()
  const ledger = schema.dispatchPerformanceSettledBatches
  const stageDone =
    stage === 'exit'
      ? sql`${ledger.exitSettledAt} IS NOT NULL`
      : opts?.excludeProvisional
        ? sql`${ledger.dispatchSettledAt} IS NOT NULL AND ${ledger.dispatchSettledProvisional} = false`
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
export type DispatchPerformanceStatRow = Omit<Acc, 'dispatchSettled' | ExcludedAccKey> & {
  arrivalDate: string
  supplierKey: string
  supplierName: string
  vendorCode: string
  routeCode: string
  courierCode: string
  courierName: string
  isWhitelist: boolean
  dispatchSettled: boolean
  /** 只有 queryDispatchPerformance 按自然键关联异常报备后才会填；纯函数单测不用管 */
  excludedSignCount?: number
  excludedNextDaySignCount?: number
  excludedPriorityNextDaySignCount?: number
  neverSignedWaybillNos: unknown
  lateSignedWaybillNos: unknown
  problemWaybillNos: unknown
  before11UnmetWaybillNos: unknown
}

/**
 * 这条路由在当前配置里是否「名不副实」：落在 supplierKey 名下，但 supplierKey 自己配置的
 * routeCodes 不含这条路由（即 aggregateCells 的兜底计入），而别的供应商单位配了它。
 * 找不到 routeOwnerUnits（未传）、路由码为空、或 supplierKey 自己就配了这条路由，一律不标注。
 */
function resolveForeignVendorName(
  routeOwnerUnits: Map<string, SupplierUnit> | undefined,
  supplierKey: string,
  routeCode: string,
): string | undefined {
  if (!routeOwnerUnits || !routeCode) return undefined
  const ownUnit = routeOwnerUnits.get(supplierKey)
  if (!ownUnit || ownUnit.routeCodes.size === 0 || ownUnit.routeCodes.has(routeCode)) return undefined
  const owner = [...routeOwnerUnits.values()].find(
    (u) => u.supplierKey !== supplierKey && u.routeCodes.has(routeCode),
  )
  return owner?.supplierName
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
  /** 供应商单位索引（当前配置，非落库快照），用于给路由标注「所属供应商」；缺省 = 不标注 */
  routeOwnerUnits?: Map<string, SupplierUnit>,
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

  // 排序统一按「高优件次日完成率从低到高」：分析页要先看到最差的那几家/几条路由/几个司机；
  // 没有优先件或未结算时该率为 null，排不出差好，扔到最后不参与比较
  const byPriorityRateAsc = (a: { priorityNextDaySignRate: number | null }, b: { priorityNextDaySignRate: number | null }) => {
    if (a.priorityNextDaySignRate == null) return b.priorityNextDaySignRate == null ? 0 : 1
    if (b.priorityNextDaySignRate == null) return -1
    return a.priorityNextDaySignRate - b.priorityNextDaySignRate
  }
  const supplierNodes: DispatchPerformanceSupplierNode[] = [...suppliers.values()]
    .map((supplier) => ({
      supplierKey: supplier.supplierKey,
      supplierName: supplier.supplierName,
      vendorCode: supplier.vendorCode,
      ...toMetrics(supplier.acc),
      routes: [...supplier.routes.values()]
        .map((route) => ({
          routeCode: route.routeCode,
          whitelistTotal: route.whitelistTotal,
          ...toMetrics(route.acc),
          foreignVendorName: resolveForeignVendorName(routeOwnerUnits, supplier.supplierKey, route.routeCode),
          drivers: [...route.drivers.values()]
            .map((driver) => ({
              courierCode: driver.courierCode,
              courierName: driver.courierName,
              ...toMetrics(driver.acc),
              neverSignedWaybillNos: driver.neverSignedWaybillNos,
              lateSignedWaybillNos: driver.lateSignedWaybillNos,
              problemWaybillNos: driver.problemWaybillNos,
              before11UnmetWaybillNos: driver.before11UnmetWaybillNos,
            }))
            .sort(byPriorityRateAsc),
        }))
        .sort(byPriorityRateAsc),
    }))
    .sort(byPriorityRateAsc)

  return {
    overall: toMetrics(overallAcc),
    whitelistTotal: overallWhitelistTotal,
    suppliers: supplierNodes,
  }
}

const CELL_KEY_SEP_EXC = '\t'

/** 自然键：(到件日, 供应商, 路由码, 司机)，用于把异常报备关联到日度表的格子，不走外键 */
function naturalCellKey(arrivalDate: string, supplierKey: string, routeCode: string, courierCode: string): string {
  return [arrivalDate, supplierKey, routeCode, courierCode].join(CELL_KEY_SEP_EXC)
}

/** reportedSet 里有多少个号出现在 actualArr（该格子当前的未达标运单号数组）里 */
function countInSet(reportedSet: Set<string>, actualArr: unknown): number {
  let n = 0
  for (const no of asStrings(actualArr)) if (reportedSet.has(no)) n++
  return n
}

/**
 * 同 countInSet，但「未达标」判定要看多个数组的并集——24H 口径下 neverSignedWaybillNos 和
 * lateSignedWaybillNos 都算未达标（都保证 signMet=false），报备的号命中任意一个都该生效。
 */
function countInAnySet(reportedSet: Set<string>, ...actualArrs: unknown[]): number {
  const union = new Set<string>()
  for (const arr of actualArrs) for (const no of asStrings(arr)) union.add(no)
  let n = 0
  for (const no of reportedSet) if (union.has(no)) n++
  return n
}

/**
 * 按自然键把区间内的异常报备运单号合并起来，供 queryDispatchPerformance 在累加前
 * 与每个格子的 neverSignedWaybillNos 求交集。同一格子可能有多条报备（多次事故），取并集。
 */
async function fetchExceptionWaybillsByCell(params: {
  stationCode: string
  startDate: string
  endDate: string
  supplierKeys?: string[]
}): Promise<Map<string, Set<string>>> {
  const db = getDb()
  const e = schema.dispatchPerformanceExceptions
  const conditions = [
    eq(e.stationCode, params.stationCode),
    gte(e.arrivalDate, params.startDate),
    lte(e.arrivalDate, params.endDate),
  ]
  if (params.supplierKeys?.length) conditions.push(inArray(e.supplierKey, params.supplierKeys))
  const rows = await db.select().from(e).where(and(...conditions))

  const byCell = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = naturalCellKey(row.arrivalDate, row.supplierKey, row.routeCode, row.courierCode)
    let set = byCell.get(key)
    if (!set) {
      set = new Set()
      byCell.set(key, set)
    }
    for (const no of asStrings(row.waybillNos)) set.add(no)
  }
  return byCell
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

  const [rows, exceptionsByCell, routeOwnerUnits] = await Promise.all([
    db.select().from(t).where(and(...conditions)),
    fetchExceptionWaybillsByCell({ stationCode, startDate, endDate, supplierKeys }),
    resolveRouteOwnerUnits(stationCode),
  ])

  // 报备只在这里生效一次：与该格子当前的 neverSignedWaybillNos 求交集，不信任报备时刻的快照——
  // 报备早于结算时交集为空（剔除数为 0），结算跑完后下次查询自动生效；数据被纠正也会自动跟着变。
  const enrichedRows = exceptionsByCell.size
    ? rows.map((row) => {
        const reported = exceptionsByCell.get(
          naturalCellKey(row.arrivalDate, row.supplierKey, row.routeCode, row.courierCode),
        )
        if (!reported || reported.size === 0) return row
        return {
          ...row,
          // 24H 派签率：从未签收 + 迟签收都算未达标，两个数组求并集再比对
          excludedSignCount: countInAnySet(reported, row.neverSignedWaybillNos, row.lateSignedWaybillNos),
          // 次日派签率的截止时间不同，必须认专门存的 nextDayUnmetWaybillNos，不能复用上面那个并集
          excludedNextDaySignCount: countInSet(reported, row.nextDayUnmetWaybillNos),
          excludedPriorityNextDaySignCount: countInSet(reported, row.priorityNextDayUnmetWaybillNos),
        }
      })
    : rows

  return {
    stationCode,
    startDate,
    endDate,
    // 跟着口径走：剔除白名单时，只有白名单数据的那天就是「这天没数据」
    arrivalDates: [
      ...new Set(rows.filter((r) => includeWhitelist || !r.isWhitelist).map((r) => r.arrivalDate)),
    ].sort(),
    ...buildDispatchPerformanceTree(enrichedRows, includeWhitelist, routeOwnerUnits),
  }
}

/**
 * 该站点当前勾选的供应商单位索引，供「所属供应商」标注用实时配置、不是落库快照。
 * 与 dailyStatsJob.resolveStationTargets 同一套取数方式（listSupplierPushConfigs 全量 + 按
 * pushConfigIds 过滤 + 要求 vendorCode 非空），没有配置或站点未启用统计时返回空索引。
 */
async function resolveRouteOwnerUnits(stationCode: string): Promise<Map<string, SupplierUnit>> {
  const db = getDb()
  const configRows = await db
    .select({ pushConfigIds: schema.dispatchPerformanceConfigs.pushConfigIds })
    .from(schema.dispatchPerformanceConfigs)
    .where(eq(schema.dispatchPerformanceConfigs.stationCode, stationCode))
    .limit(1)
  const pushConfigIds = parsePushConfigIds(configRows[0]?.pushConfigIds)
  if (!pushConfigIds.length) return new Map()

  const supplierConfigs = await listSupplierPushConfigs()
  const byId = new Map(supplierConfigs.map((c) => [c.id, c]))
  const stationConfigs = pushConfigIds
    .map((id) => byId.get(id))
    .filter((c): c is FleetSupplierPushConfig => c != null && Boolean(c.vendorCode?.trim()))
  return buildSupplierUnitIndex(stationConfigs).units
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

// ── 派签异常报备：司机不可抗力事件的按件剔除，见 schema.ts dispatchPerformanceExceptions ──────

export type DispatchPerformanceExceptionInput = {
  stationCode: string
  arrivalDate: string
  supplierKey: string
  routeCode: string
  courierCode: string
  waybillNos: string[]
  reason: string
  reportedBy: string | null
  reportedByName: string
}

/**
 * 创建报备：不校验运单号是否已经是「未签收」——报备时刻通常早于结算（事故当天就要报，
 * 派签要 D+2 才结算），此时格子可能压根还没落库。是否真的生效交给查询时的交集逻辑
 * （见 queryDispatchPerformance），结算跑完后自动生效，不需要再操作一次。
 */
export async function createDispatchPerformanceException(input: DispatchPerformanceExceptionInput) {
  const db = getDb()
  const [row] = await db
    .insert(schema.dispatchPerformanceExceptions)
    .values({
      stationCode: input.stationCode,
      arrivalDate: input.arrivalDate,
      supplierKey: input.supplierKey,
      routeCode: input.routeCode,
      courierCode: input.courierCode,
      waybillNos: input.waybillNos,
      reason: input.reason,
      reportedBy: input.reportedBy,
      reportedByName: input.reportedByName,
    })
    .returning()
  return row
}

export type DispatchPerformanceExceptionView = typeof schema.dispatchPerformanceExceptions.$inferSelect & {
  /** 报备的运单号数 */
  reportedCount: number
  /** 与该格子当前 neverSignedWaybillNos 求交集后，真正生效的剔除数；可能小于 reportedCount */
  effectiveCount: number
  /** 该格子的派签是否已结算；未结算时 effectiveCount 恒为 0，前端要提示「等结算后生效」而非「无效」 */
  settled: boolean
}

/**
 * 列出区间内的报备记录，并算出每条记录「当前实际生效多少件」——不能只回报备时提交了多少件，
 * 那对不上 queryDispatchPerformance 实际剔除的数字，用户会怀疑报了没用。
 */
export async function listDispatchPerformanceExceptions(params: {
  stationCode: string
  startDate: string
  endDate: string
  supplierKey?: string
  routeCode?: string
  courierCode?: string
}): Promise<DispatchPerformanceExceptionView[]> {
  const db = getDb()
  const e = schema.dispatchPerformanceExceptions
  const conditions = [
    eq(e.stationCode, params.stationCode),
    gte(e.arrivalDate, params.startDate),
    lte(e.arrivalDate, params.endDate),
  ]
  if (params.supplierKey) conditions.push(eq(e.supplierKey, params.supplierKey))
  if (params.routeCode != null) conditions.push(eq(e.routeCode, params.routeCode))
  if (params.courierCode != null) conditions.push(eq(e.courierCode, params.courierCode))

  const exceptions = await db.select().from(e).where(and(...conditions)).orderBy(desc(e.createdAt))
  if (exceptions.length === 0) return []

  const dates = [...new Set(exceptions.map((x) => x.arrivalDate))]
  const t = schema.dispatchPerformanceDailyStats
  const statRows = await db
    .select()
    .from(t)
    .where(and(eq(t.stationCode, params.stationCode), inArray(t.arrivalDate, dates)))
  const statByCell = new Map<string, (typeof statRows)[number]>()
  for (const row of statRows) {
    statByCell.set(naturalCellKey(row.arrivalDate, row.supplierKey, row.routeCode, row.courierCode), row)
  }

  return exceptions.map((x) => {
    const stat = statByCell.get(naturalCellKey(x.arrivalDate, x.supplierKey, x.routeCode, x.courierCode))
    const reportedNos = asStrings(x.waybillNos)
    // 面板里只展示一个「当前生效」数，认 24H 口径（从未签收 + 迟签收）这个最常用的口径；
    // 次日/优先件口径各自的生效数可能略有差异，详细拆分交给三层汇总表格里的率变化去体现
    const effectiveCount = stat
      ? countInAnySet(new Set(reportedNos), stat.neverSignedWaybillNos, stat.lateSignedWaybillNos)
      : 0
    return {
      ...x,
      reportedCount: reportedNos.length,
      effectiveCount,
      settled: stat?.dispatchSettled ?? false,
    }
  })
}

/**
 * 必须带 stationCode 一起校验，不能只按 id 删——否则任何能访问某一条配置的用户，
 * 拿到别的站点的 exceptionId 就能越权删掉它。id 存在但 stationCode 对不上时，
 * 跟「id 根本不存在」一样返回 false，不额外暴露「这个 id 其实存在，只是不是你的」。
 */
export async function deleteDispatchPerformanceException(id: string, stationCode: string): Promise<boolean> {
  const db = getDb()
  const e = schema.dispatchPerformanceExceptions
  const deleted = await db
    .delete(e)
    .where(and(eq(e.id, id), eq(e.stationCode, stationCode)))
    .returning({ id: e.id })
  return deleted.length > 0
}
