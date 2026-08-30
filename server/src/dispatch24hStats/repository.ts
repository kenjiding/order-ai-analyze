/**
 * 出仓派签达成分析的落库与查询。
 *
 * 表里只有最细粒度格子，供应商层/路由码层在这里 SUM 出来——所有百分比都由四象限导出，
 * 不在库里冗余存 rate，避免「存的率」和「重算的率」哪天对不上。
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { DispatchPerformanceCell } from './aggregateCells'

/** 日度指标保留天数：日度表体积很小，留半年支撑趋势对比 */
export const DISPATCH_PERFORMANCE_RETENTION_DAYS = 180

const UPSERT_CHUNK_SIZE = 500

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
  problemCount: number
  neverSignedCount: number
  lateSignedCount: number
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
  problemCount: number
  neverSignedCount: number
  lateSignedCount: number
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
    problemCount: 0,
    neverSignedCount: 0,
    lateSignedCount: 0,
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
  acc.problemCount += row.problemCount
  acc.neverSignedCount += row.neverSignedCount
  acc.lateSignedCount += row.lateSignedCount
  acc.dispatchSettled &&= row.dispatchSettled
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
    problemCount: acc.problemCount,
    neverSignedCount: acc.neverSignedCount,
    lateSignedCount: acc.lateSignedCount,
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
      courierCode: cell.courierCode,
      courierName: cell.courierName,
      total: cell.total,
      before11Met: cell.before11Met,
      dispatchSettled: cell.dispatchSettled,
      exitMetSignMet: cell.exitMetSignMet,
      exitMetSignUnmet: cell.exitMetSignUnmet,
      exitUnmetSignMet: cell.exitUnmetSignMet,
      exitUnmetSignUnmet: cell.exitUnmetSignUnmet,
      problemCount: cell.problemCount,
      neverSignedCount: cell.neverSignedCount,
      lateSignedCount: cell.lateSignedCount,
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

/**
 * 查询区间内的三层结果。区间跨多天时同一 (supplier, route, courier) 会有多行，按维度累加。
 */
export async function queryDispatchPerformance(params: {
  stationCode: string
  startDate: string
  endDate: string
  supplierKeys?: string[]
}): Promise<DispatchPerformanceQueryResult> {
  const { stationCode, startDate, endDate, supplierKeys } = params
  const db = getDb()
  const t = schema.dispatchPerformanceDailyStats

  const conditions = [
    eq(t.stationCode, stationCode),
    gte(t.arrivalDate, startDate),
    lte(t.arrivalDate, endDate),
  ]
  if (supplierKeys?.length) conditions.push(inArray(t.supplierKey, supplierKeys))

  const rows = await db.select().from(t).where(and(...conditions))

  const arrivalDates = [...new Set(rows.map((r) => r.arrivalDate))].sort()
  const overallAcc = newAcc()

  type SupplierBucket = {
    supplierKey: string
    supplierName: string
    vendorCode: string
    acc: Acc
    routes: Map<string, { routeCode: string; acc: Acc; drivers: Map<string, DriverBucket> }>
  }
  type DriverBucket = {
    courierCode: string
    courierName: string
    acc: Acc
    neverSignedWaybillNos: string[]
    lateSignedWaybillNos: string[]
    problemWaybillNos: string[]
    before11UnmetWaybillNos: string[]
  }

  const suppliers = new Map<string, SupplierBucket>()

  for (const row of rows) {
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
      route = { routeCode: row.routeCode, acc: newAcc(), drivers: new Map() }
      supplier.routes.set(row.routeCode, route)
    }
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
    driver.neverSignedWaybillNos.push(...asStrings(row.neverSignedWaybillNos))
    driver.lateSignedWaybillNos.push(...asStrings(row.lateSignedWaybillNos))
    driver.problemWaybillNos.push(...asStrings(row.problemWaybillNos))
    driver.before11UnmetWaybillNos.push(...asStrings(row.before11UnmetWaybillNos))
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
    stationCode,
    startDate,
    endDate,
    arrivalDates,
    overall: toMetrics(overallAcc),
    suppliers: supplierNodes,
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

/** 删除超过保留期的日度指标（按 arrival_date 的字符串比较，格式固定 YYYY-MM-DD 可直接比） */
export async function purgeOldDispatchPerformanceStats(
  keepDays = DISPATCH_PERFORMANCE_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const db = getDb()
  const deleted = await db
    .delete(schema.dispatchPerformanceDailyStats)
    .where(sql`${schema.dispatchPerformanceDailyStats.arrivalDate} < ${cutoff}`)
    .returning({ id: schema.dispatchPerformanceDailyStats.id })
  return deleted.length
}
