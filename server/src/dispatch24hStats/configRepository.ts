/**
 * 出仓派签达成分析的站点配置读写，以及列表页要用的「各站点最近一批结算概览」。
 *
 * 列表页不是光秃秃的配置注册表：每行直接带该站点最近已结算那天的两个率，
 * 一眼看出哪个站点有问题，再点进详情页下钻到供应商/路由码/司机。
 */
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { DispatchPerformanceConfig, RegionCalendarOverride } from '../db/schema'
import { LEGACY_GLOBAL_SUPPLIER_REGION_CODE, listSupplierPushConfigs, parsePushConfigIds } from '../supplierPushConfigs'
import { buildSupplierUnitIndex } from '../vendorAnalysis/supplierScope'
import type { AusTz } from '../imile/ausTimezone'
import { MIN_SORTING_WAYBILLS, type RegionCalendarOverrides } from '../imile/sortingWorkday'
import { toMetrics, type DispatchPerformanceMetrics } from './repository'
import { dispatchBatchSettleMs, SETTLE_DUE_WINDOW_MS } from './settledArrivalDates'

/**
 * 某 regionCode 的全部出仓/派送例外覆盖，结算/展示按需查一次即可——表很小，没必要做缓存。
 * 查不到任何例外时返回空表，isSortingWorkday/isDispatchDay 会据此退化成纯周末判断。
 */
export async function loadRegionCalendarOverrides(regionCode: string | null): Promise<RegionCalendarOverrides> {
  const db = getDb()
  const t = schema.regionCalendarOverrides
  const rows = await db.select().from(t).where(eq(t.regionCode, regionCode ?? ''))
  return new Map(rows.map((r) => [r.date, { isExitDay: r.isExitDay, isDispatchDay: r.isDispatchDay }]))
}

/** 管理用：某 regionCode 的全部例外行（含 id，供编辑/删除），按日期升序 */
export async function listRegionCalendarOverrides(regionCode: string): Promise<RegionCalendarOverride[]> {
  const db = getDb()
  const t = schema.regionCalendarOverrides
  return db.select().from(t).where(eq(t.regionCode, regionCode)).orderBy(asc(t.date))
}

/** 新增/修改某天的覆盖，按 (regionCode, date) upsert——同一天重复插入即覆盖旧值，不会重复建行 */
export async function upsertRegionCalendarOverride(input: {
  regionCode: string
  date: string
  isExitDay?: boolean | null
  isDispatchDay?: boolean | null
  note?: string
  userId: string | null
}): Promise<RegionCalendarOverride> {
  const db = getDb()
  const t = schema.regionCalendarOverrides
  const rows = await db
    .insert(t)
    .values({
      regionCode: input.regionCode,
      date: input.date,
      isExitDay: input.isExitDay ?? null,
      isDispatchDay: input.isDispatchDay ?? null,
      note: input.note ?? '',
      createdBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [t.regionCode, t.date],
      set: {
        isExitDay: input.isExitDay ?? null,
        isDispatchDay: input.isDispatchDay ?? null,
        note: input.note ?? '',
        updatedAt: new Date(),
      },
    })
    .returning()
  return rows[0]
}

export async function deleteRegionCalendarOverride(id: string): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .delete(schema.regionCalendarOverrides)
    .where(eq(schema.regionCalendarOverrides.id, id))
    .returning({ id: schema.regionCalendarOverrides.id })
  return rows.length > 0
}

/** 该站点最近一个有数据的到件日及其汇总指标；从未结算过则为 null */
export type DispatchPerformanceLatestSnapshot = {
  arrivalDate: string
  metrics: DispatchPerformanceMetrics
}

export type DispatchPerformanceConfigView = {
  id: string
  stationCode: string
  stationName: string
  regionCode: string
  isEnabled: boolean
  createdAt: string
  updatedAt: string
  /** 纳入统计的供应商 = fleet_supplier_push_configs 的行 id 列表，用户在配置抽屉里勾选 */
  pushConfigIds: string[]
  /** 每天几点触发结算，HH:mm，按该站点所属州的本地时间 */
  settleTime: string
  /** 「这天算不算开仓分拣」的到件量阈值覆盖；null = 沿用全局 MIN_SORTING_WAYBILLS */
  minSortingWaybills: number | null
  /** 上面这些配置归并出的供应商单位数（同一家的多条配置算一家），实时算、不落库 */
  supplierCount: number
  /** 最近一个有数据的到件日（出仓率看它）。派签在这天多半还没结算 */
  latest: DispatchPerformanceLatestSnapshot | null
  /**
   * 最近一个**派签已结算**的到件日，比 latest 早一天左右。
   *
   * 派签率不能读 latest：两个指标结算时机差一天，最新那天的派签**必然**还没结算，
   * 读 latest 会让这一列永远显示「结算中」，用户点多少次「立刻统计」都不会变。
   */
  latestDispatch: DispatchPerformanceLatestSnapshot | null
}

/** 站点归属本账号可见范围：历史 global 数据对所有人可见，其余按州隔离，与供应商配置一致 */
function regionVisible(regionCode: string | null | undefined) {
  const t = schema.dispatchPerformanceConfigs
  if (!regionCode) return or(eq(t.regionCode, LEGACY_GLOBAL_SUPPLIER_REGION_CODE), eq(t.regionCode, ''))
  return or(
    eq(t.regionCode, regionCode),
    eq(t.regionCode, LEGACY_GLOBAL_SUPPLIER_REGION_CODE),
    eq(t.regionCode, ''),
  )
}

export async function listDispatchPerformanceConfigs(
  regionCode: string | null | undefined,
): Promise<DispatchPerformanceConfig[]> {
  const db = getDb()
  const t = schema.dispatchPerformanceConfigs
  return db.select().from(t).where(regionVisible(regionCode)).orderBy(asc(t.createdAt))
}

/** 结算任务用：所有已启用的配置，不做州过滤（系统级任务没有账号上下文） */
export async function listEnabledDispatchPerformanceConfigs(): Promise<DispatchPerformanceConfig[]> {
  const db = getDb()
  const t = schema.dispatchPerformanceConfigs
  return db.select().from(t).where(eq(t.isEnabled, true)).orderBy(asc(t.createdAt))
}

export async function findDispatchPerformanceConfig(
  id: string,
): Promise<DispatchPerformanceConfig | null> {
  const db = getDb()
  const t = schema.dispatchPerformanceConfigs
  const rows = await db.select().from(t).where(eq(t.id, id)).limit(1)
  return rows[0] ?? null
}

/**
 * 「这天算不算开仓分拣」的到件量阈值：站点有覆盖配置则用它，否则沿用全局 MIN_SORTING_WAYBILLS。
 * 与 isEnabled 无关——覆盖值是站点体量的客观事实，不随「出仓派签达成分析」功能是否启用而失效。
 * 24H 派签告警、滞留数据告警（exit-alarm）与本模块共用同一份覆盖，见 db/schema.ts 字段注释。
 */
export async function resolveMinSortingWaybills(stationCode: string): Promise<number> {
  const db = getDb()
  const t = schema.dispatchPerformanceConfigs
  const rows = await db
    .select({ minSortingWaybills: t.minSortingWaybills })
    .from(t)
    .where(eq(t.stationCode, stationCode))
    .limit(1)
  return rows[0]?.minSortingWaybills ?? MIN_SORTING_WAYBILLS
}

/** 站点是否已被别的配置占用（新增时 excludeId 为空，编辑时排除自己） */
export async function isStationTaken(stationCode: string, excludeId?: string): Promise<boolean> {
  const db = getDb()
  const t = schema.dispatchPerformanceConfigs
  const conditions = [eq(t.stationCode, stationCode)]
  if (excludeId) conditions.push(ne(t.id, excludeId))
  const rows = await db.select({ id: t.id }).from(t).where(and(...conditions)).limit(1)
  return rows.length > 0
}

export async function createDispatchPerformanceConfig(input: {
  stationCode: string
  stationName: string
  regionCode: string
  pushConfigIds: string[]
  settleTime: string
  /** 为空 = 沿用全局 MIN_SORTING_WAYBILLS，见 schema 注释 */
  minSortingWaybills?: number | null
  isEnabled: boolean
  userId: string | null
}): Promise<DispatchPerformanceConfig> {
  const db = getDb()
  const rows = await db
    .insert(schema.dispatchPerformanceConfigs)
    .values({
      stationCode: input.stationCode,
      stationName: input.stationName,
      regionCode: input.regionCode,
      pushConfigIds: input.pushConfigIds,
      settleTime: input.settleTime,
      minSortingWaybills: input.minSortingWaybills ?? null,
      isEnabled: input.isEnabled,
      createdBy: input.userId,
      updatedBy: input.userId,
    })
    .returning()
  return rows[0]
}

export async function updateDispatchPerformanceConfig(
  id: string,
  input: {
    stationCode?: string
    stationName?: string
    pushConfigIds?: string[]
    settleTime?: string
    /** undefined = 不改；null = 清空覆盖、改回沿用全局默认 */
    minSortingWaybills?: number | null
    isEnabled?: boolean
    userId: string | null
  },
): Promise<DispatchPerformanceConfig | null> {
  const db = getDb()
  const rows = await db
    .update(schema.dispatchPerformanceConfigs)
    .set({
      ...(input.stationCode != null ? { stationCode: input.stationCode } : {}),
      ...(input.stationName != null ? { stationName: input.stationName } : {}),
      ...(input.pushConfigIds != null ? { pushConfigIds: input.pushConfigIds } : {}),
      ...(input.settleTime != null ? { settleTime: input.settleTime } : {}),
      ...(input.minSortingWaybills !== undefined
        ? { minSortingWaybills: input.minSortingWaybills }
        : {}),
      ...(input.isEnabled != null ? { isEnabled: input.isEnabled } : {}),
      updatedBy: input.userId,
      updatedAt: new Date(),
    })
    .where(eq(schema.dispatchPerformanceConfigs.id, id))
    .returning()
  return rows[0] ?? null
}

/**
 * 删除配置。已结算的日度数据**不一起删** —— 那是历史统计事实，
 * 与「今后还统计不统计这个站点」是两回事；重新添加同一站点即可继续看到历史。
 */
export async function deleteDispatchPerformanceConfig(id: string): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .delete(schema.dispatchPerformanceConfigs)
    .where(eq(schema.dispatchPerformanceConfigs.id, id))
    .returning({ id: schema.dispatchPerformanceConfigs.id })
  return rows.length > 0
}

/**
 * 每条配置勾选的那些供应商配置，归并出多少个「供应商单位」。
 *
 * 不能直接数 pushConfigIds 的长度：同一家供应商会在多个 region 各建一条配置
 * （ADL-Lu 在 SA 和 system 各一条），按行数会把一家数成两家。归并口径与结算完全一致。
 */
function countSupplierUnits(
  configs: DispatchPerformanceConfig[],
  supplierConfigs: Awaited<ReturnType<typeof listSupplierPushConfigs>>,
): Map<string, number> {
  const byId = new Map(supplierConfigs.map((c) => [c.id, c]))
  return new Map(
    configs.map((config) => {
      const picked = parsePushConfigIds(config.pushConfigIds)
        .map((id) => byId.get(id))
        .filter((c): c is (typeof supplierConfigs)[number] => c != null && Boolean(c.vendorCode?.trim()))
      return [config.id, buildSupplierUnitIndex(picked).units.size]
    }),
  )
}

/**
 * 各站点最近一个有数据的到件日 + 该日汇总指标。
 *
 * 两步走：先按站点取 max(arrival_date)，再只聚合那一天的格子——
 * 直接把全部历史行拉回来在内存里挑最新，站点一多就是无谓的全表扫描。
 *
 * **两步都要排除白名单格子**：这里出的是列表页那两个率，列表页没有口径切换，固定剔除白名单，
 * 与详情页的默认口径一致（详情页现在可以切到「全量」，见 queryDispatchPerformance 的
 * includeWhitelist；两个页面的口径届时会不一致，是预期的，详情页顶部会提示当前口径）。
 * 只在第二步排除是不够的——那样某天若只有白名单数据，max() 仍会选中它，
 * 聚合却是空的，这一行会变成「有日期没数据」。
 * 例外：优先件总数/完成数不按白名单剔除（该供应商全部优先件），第二步对其余列用 filter 排除白名单。
 */
async function loadLatestSnapshots(
  stationCodes: string[],
  /** true = 只看派签已结算的那些天，用于「24H派签率」列 */
  dispatchSettledOnly = false,
): Promise<Map<string, DispatchPerformanceLatestSnapshot>> {
  const result = new Map<string, DispatchPerformanceLatestSnapshot>()
  if (stationCodes.length === 0) return result

  const db = getDb()
  const t = schema.dispatchPerformanceDailyStats

  const assessed = [inArray(t.stationCode, stationCodes), eq(t.isWhitelist, false)]
  const scope = dispatchSettledOnly
    ? and(...assessed, eq(t.dispatchSettled, true))
    : and(...assessed)

  const latestDates = await db
    .select({ stationCode: t.stationCode, arrivalDate: sql<string>`max(${t.arrivalDate})` })
    .from(t)
    .where(scope)
    .groupBy(t.stationCode)
  if (latestDates.length === 0) return result

  const pairs = sql.join(
    latestDates.map((d) => sql`(${d.stationCode}, ${d.arrivalDate})`),
    sql`, `,
  )
  // 考核指标不含白名单；优先件是该供应商全部的，不按白名单剔除（与 buildDispatchPerformanceTree 同口径）
  const assessedOnly = sql`filter (where ${t.isWhitelist} = false)`
  const rows = await db
    .select({
      stationCode: t.stationCode,
      arrivalDate: t.arrivalDate,
      total: sql<number>`sum(${t.total}) ${assessedOnly}::int`,
      before11Met: sql<number>`sum(${t.before11Met}) ${assessedOnly}::int`,
      exitMetSignMet: sql<number>`sum(${t.exitMetSignMet}) ${assessedOnly}::int`,
      exitMetSignUnmet: sql<number>`sum(${t.exitMetSignUnmet}) ${assessedOnly}::int`,
      exitUnmetSignMet: sql<number>`sum(${t.exitUnmetSignMet}) ${assessedOnly}::int`,
      exitUnmetSignUnmet: sql<number>`sum(${t.exitUnmetSignUnmet}) ${assessedOnly}::int`,
      sameDayExitMet: sql<number>`sum(${t.sameDayExitMet}) ${assessedOnly}::int`,
      nextDaySignMet: sql<number>`sum(${t.nextDaySignMet}) ${assessedOnly}::int`,
      priorityTotal: sql<number>`sum(${t.priorityTotal})::int`,
      priorityNextDaySignMet: sql<number>`sum(${t.priorityNextDaySignMet})::int`,
      exitMetNextDaySignMet: sql<number>`sum(${t.exitMetNextDaySignMet}) ${assessedOnly}::int`,
      priorityBefore11Met: sql<number>`sum(${t.priorityBefore11Met})::int`,
      priorityExitMetNextDaySignMet: sql<number>`sum(${t.priorityExitMetNextDaySignMet})::int`,
      problemCount: sql<number>`sum(${t.problemCount}) ${assessedOnly}::int`,
      neverSignedCount: sql<number>`sum(${t.neverSignedCount}) ${assessedOnly}::int`,
      lateSignedCount: sql<number>`sum(${t.lateSignedCount}) ${assessedOnly}::int`,
      // 金额不按白名单剔除（同 priorityTotal）：白名单路由不考核，但钱照样发生了
      vendorProfit: sql<number>`coalesce(sum(${t.vendorProfit}), 0)::double precision`,
      courierProfit: sql<number>`coalesce(sum(${t.courierProfit}), 0)::double precision`,
      pricedSignedCount: sql<number>`coalesce(sum(${t.pricedSignedCount}), 0)::int`,
      unpricedSignedCount: sql<number>`coalesce(sum(${t.unpricedSignedCount}), 0)::int`,
      // 只要该日混进一行未结算，整日就算未结算——宁可显示结算中，也不摆出算了一半的数
      dispatchSettled: sql<boolean>`bool_and(${t.dispatchSettled})`,
    })
    .from(t)
    .where(sql`(${t.stationCode}, ${t.arrivalDate}) IN (${pairs})`)
    .groupBy(t.stationCode, t.arrivalDate)

  for (const row of rows) {
    result.set(row.stationCode, {
      arrivalDate: row.arrivalDate,
      metrics: toMetrics({
        total: row.total,
        before11Met: row.before11Met,
        exitMetSignMet: row.exitMetSignMet,
        exitMetSignUnmet: row.exitMetSignUnmet,
        exitUnmetSignMet: row.exitUnmetSignMet,
        exitUnmetSignUnmet: row.exitUnmetSignUnmet,
        sameDayExitMet: row.sameDayExitMet,
        nextDaySignMet: row.nextDaySignMet,
        priorityTotal: row.priorityTotal,
        priorityNextDaySignMet: row.priorityNextDaySignMet,
        exitMetNextDaySignMet: row.exitMetNextDaySignMet,
        priorityBefore11Met: row.priorityBefore11Met,
        priorityExitMetNextDaySignMet: row.priorityExitMetNextDaySignMet,
        problemCount: row.problemCount,
        neverSignedCount: row.neverSignedCount,
        lateSignedCount: row.lateSignedCount,
        vendorProfit: row.vendorProfit,
        courierProfit: row.courierProfit,
        pricedSignedCount: row.pricedSignedCount,
        unpricedSignedCount: row.unpricedSignedCount,
        // 列表页只是站点概览小卡片，不按异常报备做剔除（那是详情页的口径），恒为 0
        excludedSignCount: 0,
        excludedNextDaySignCount: 0,
        excludedPriorityNextDaySignCount: 0,
        dispatchSettled: row.dispatchSettled,
      }),
    })
  }
  return result
}

/** 列表页数据：配置 + 供应商数 + 最近一批结算概览 */
export async function listDispatchPerformanceConfigViews(
  regionCode: string | null | undefined,
): Promise<DispatchPerformanceConfigView[]> {
  const configs = await listDispatchPerformanceConfigs(regionCode)
  const stationCodes = [...new Set(configs.map((c) => c.stationCode))]
  const [supplierConfigs, snapshots, dispatchSnapshots] = await Promise.all([
    listSupplierPushConfigs(),
    loadLatestSnapshots(stationCodes),
    loadLatestSnapshots(stationCodes, true),
  ])
  const supplierCounts = countSupplierUnits(configs, supplierConfigs)

  return configs.map((config) => ({
    id: config.id,
    stationCode: config.stationCode,
    stationName: config.stationName,
    regionCode: config.regionCode,
    isEnabled: config.isEnabled,
    createdAt: new Date(config.createdAt).toISOString(),
    updatedAt: new Date(config.updatedAt).toISOString(),
    pushConfigIds: parsePushConfigIds(config.pushConfigIds),
    settleTime: config.settleTime,
    minSortingWaybills: config.minSortingWaybills,
    supplierCount: supplierCounts.get(config.id) ?? 0,
    latest: snapshots.get(config.stationCode) ?? null,
    latestDispatch: dispatchSnapshots.get(config.stationCode) ?? null,
  }))
}

/** 最近 N 个已结算到件日（降序），供详情页展示「结算进度」 */
export async function listRecentSettledBatches(
  stationCode: string,
  tz: AusTz,
  overrides: RegionCalendarOverrides = new Map(),
  limit = 10,
): Promise<
  {
    arrivalDate: string
    exitSettled: boolean
    dispatchSettled: boolean
    /** 派签窗口的 50h 补跑期已过、台账仍没盖章——不会再自动补，永远卡在"结算中"，需要人工介入 */
    dispatchOverdue: boolean
    waybillCount: number
  }[]
> {
  const db = getDb()
  const t = schema.dispatchPerformanceSettledBatches
  const rows = await db
    .select()
    .from(t)
    .where(eq(t.stationCode, stationCode))
    .orderBy(desc(t.arrivalDate))
    .limit(limit)
  const nowMs = Date.now()
  return rows.map((r) => {
    const dispatchSettled = r.dispatchSettledAt != null
    return {
      arrivalDate: r.arrivalDate,
      exitSettled: r.exitSettledAt != null,
      dispatchSettled,
      // 「立刻统计」的临时章过了补跑窗口还没被定时任务转正 = 永远不会再变了，
      // 跟从没结算过一样都要报「结算超时」——只看 dispatchSettled 会把这种情况误判成正常
      dispatchOverdue:
        (!dispatchSettled || r.dispatchSettledProvisional) &&
        nowMs > dispatchBatchSettleMs(r.arrivalDate, tz, overrides) + SETTLE_DUE_WINDOW_MS,
      waybillCount: r.waybillCount,
    }
  })
}
