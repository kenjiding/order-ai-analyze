/**
 * 出仓派签达成分析的每日结算任务，**分两趟**。
 *
 * 两个指标定终值的时间差一天，不能等到同一刻一起算：
 * - **出仓趟**：出仓日 O 的 11:00 一过就定终值（周一～周四 = 昨天到件；周五/六/日到件 = 下周一）。
 * - **派签趟**：必须等 24h 窗口到期——提前算的话，包裹会被归班盘点重新派给派送员，统计就乱了。
 *
 * 同一个到件日 D 因此被写两次：先写出仓，窗口到期后再完整重算并补上派签与四象限。
 * 何时到期由日历决定（见 settledArrivalDates），有没有批次由到件量决定（isNoSortingBatch），
 * 不按星期几筛 —— 周六/日临时开仓同样是一批，截止规则与周五一致（下周一）。
 *
 * **不回补历史**：每批只在到期后的第一次运行里结算一次（SETTLE_DUE_WINDOW_MS），漏了就永久缺这天。
 * 按日期拉运单拿到的是单据的当前状态——退回仓库、隔几天重新派送的单，回补时读到的是第二次
 * 派送的司机和时间，却被记进原到件日名下。宁可缺一天，也不要把噪声写成历史。
 * 新站点首次启用同样只从「刚到期」的那一两批开始，不追溯配置之前的日期。
 *
 * 与两个告警的关系：告警推的是「当下」的实时数据（窗口多半还没到期），本任务落的是最终值。
 * 两者共用同一套判定原语（dispatch24hAggregate / before11Exit），结论在窗口到期后必然一致。
 */
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { localDateTimeToMs, resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { loadPriorityClientCodes } from '../priorityClients'
import { isSettleTriggerDue, normalizeSettleTime } from './settleTime'
import { fetchDriverWaybills } from '../imile/driverPerformance'
import { getGlobalImileToken } from '../feishu/globalImileToken'
import { envFirst, normalizeImileToken } from '../imile/shared'
import { isNoSortingBatch, MIN_SORTING_WAYBILLS } from '../imile/sortingWorkday'
import {
  dispatchExitThresholdMs,
  resolveDispatch24hWindowRule,
  resolveExitDate,
  type Dispatch24hScope,
  type Dispatch24hWaybillRow,
} from '../vendorAnalysis/dispatch24hAggregate'
import {
  buildSupplierUnitIndex,
  supplierUnitsToScopes,
  type SupplierUnitIndex,
} from '../vendorAnalysis/supplierScope'
import {
  LEGACY_GLOBAL_SUPPLIER_REGION_CODE,
  listSupplierPushConfigs,
  parsePushConfigIds,
} from '../supplierPushConfigs'
import { listEnabledDispatchPerformanceConfigs } from './configRepository'
import {
  aggregateDispatchPerformanceCells,
  type DispatchPerformanceCell,
} from './aggregateCells'
import { loadPriceBook } from '../regionPackagePrices'
import {
  listSettledArrivalDates,
  saveDispatchPerformanceCells,
  type SettleStage,
} from './repository'
import {
  resolveDispatchDueArrivalDates,
  resolveExitDueArrivalDates,
  resolveExitSettledArrivalDates,
  resolveSettledArrivalDates,
} from './settledArrivalDates'

const LABEL = '[dispatch-performance/settle]'

/**
 * 结算用的 iMile token，取值优先级与全仓其他定时任务一致（见 feishu/globalImileToken.ts）：
 *
 *   1. 「系统设置」里的全局 token（user_preferences.app-settings.imileToken）
 *   2. 各告警配置行里的 imileToken 快照
 *   3. 环境变量兜底
 *
 * **顺序不能反**：schedule 表里的 imileToken 只是保存那条配置时从全局设置复制过去的历史快照，
 * 用户之后在「系统设置」换了 token 不会级联同步，读快照会拿到旧值报 `Invalid access token`。
 * 环境变量同理，一旦设置就永远盖住用户在页面上的更新，所以只能垫底。
 *
 * `userId` 是发起人（手动「立刻统计」传 job.createdBy）。cron 没有登录上下文，
 * 退回站点配置的创建人，再退回任一启用中的派签告警配置的归属人。
 */
export async function readDispatchPerformanceImileToken(userId?: string | null): Promise<string> {
  const db = getDb()

  const candidateUserIds: string[] = []
  const pushUserId = (id: string | null | undefined) => {
    const value = id?.trim()
    if (value && !candidateUserIds.includes(value)) candidateUserIds.push(value)
  }

  pushUserId(userId)

  const configRows = await db
    .select({
      createdBy: schema.dispatchPerformanceConfigs.createdBy,
      updatedBy: schema.dispatchPerformanceConfigs.updatedBy,
    })
    .from(schema.dispatchPerformanceConfigs)
    .where(eq(schema.dispatchPerformanceConfigs.isEnabled, true))
  for (const row of configRows) {
    pushUserId(row.updatedBy)
    pushUserId(row.createdBy)
  }

  const alarmRows = await db
    .select({
      userId: schema.dispatchAlarmSchedules.userId,
      imileToken: schema.dispatchAlarmSchedules.imileToken,
    })
    .from(schema.dispatchAlarmSchedules)
    .where(eq(schema.dispatchAlarmSchedules.isEnabled, true))
  for (const row of alarmRows) pushUserId(row.userId)

  for (const candidate of candidateUserIds) {
    const fromGlobal = await getGlobalImileToken(candidate)
    if (fromGlobal) return normalizeImileToken(fromGlobal)
  }

  const fromSchedule = alarmRows.map((r) => r.imileToken?.trim()).find((t) => !!t)
  if (fromSchedule) return normalizeImileToken(fromSchedule)

  const fromEnv = envFirst(
    'IMILE_DISPATCH_PERFORMANCE_TOKEN',
    'IMILE_DISPATCH_ALARM_TOKEN',
    'IMILE_EXIT_ALARM_TOKEN',
  )
  return fromEnv ? normalizeImileToken(fromEnv) : ''
}

export type StationTarget = {
  stationCode: string
  regionCode: string | null
  tz: AusTz
  /** 触发结算的本地时刻 HH:mm，按 tz 判定 */
  settleTime: string
  scopes: Dispatch24hScope[]
  supplierUnits: SupplierUnitIndex
  /** 「这天算不算开仓分拣」的到件量阈值，来自站点配置，未设置时沿用全局 MIN_SORTING_WAYBILLS */
  minSortingWaybills: number
}

/**
 * 结算范围：**站点和供应商都由「出仓派签达成分析」的配置显式决定**，用户在页面上勾选。
 *
 * 供应商取 config.pushConfigIds（fleet_supplier_push_configs 的行 id），与四个告警同一套。
 * **不再按 stationCode 反查该站点下的供应商** —— 那张表的 station_code 大量为空（老的全局配置）
 * 或绑在别的站点上，反查会把整站的供应商漏光：站点 S210431701 就这么中过招，9858 单一单都没
 * 匹配上，聚合出 0 个格子却照样标记「已结算」。告警侧早已弃用这条反查（见
 * listPushableSupplierPushConfigsForSchedule 的注释），这里是最后一处。
 *
 * 代价：漏勾的供应商历史数据会永久缺失（结算不回补）。安全网在 settleOneArrivalDate ——
 * 拉到了运单却聚合出 0 个格子时直接失败、不写台账，使漏勾当场暴露且能重跑。
 *
 * 勾中的配置按 supplierKey（vendorCode::展示名）归并成单位——ADL-City 与 ADL-Lu
 * 共用 vendorCode、靠路由码分家，按 vendorCode 合并会混算（见 supplierScope 的注释）。
 */
export async function resolveStationTargets(): Promise<StationTarget[]> {
  const enabled = await listEnabledDispatchPerformanceConfigs()
  if (enabled.length === 0) return []

  const supplierConfigs = await listSupplierPushConfigs()
  const byId = new Map(supplierConfigs.map((c) => [c.id, c]))

  const targets: StationTarget[] = []
  for (const config of enabled) {
    const stationCode = config.stationCode.trim()
    // 统计不推送，所以不要求供应商配了 webhook/chatId（isSupplierPushConfigured 那道门槛
    // 是推送专用的），只要求它有 vendorCode。
    const stationConfigs = parsePushConfigIds(config.pushConfigIds)
      .map((id) => byId.get(id))
      .filter((c): c is (typeof supplierConfigs)[number] => c != null && Boolean(c.vendorCode?.trim()))
    if (stationConfigs.length === 0) {
      console.warn(`${LABEL} station=${stationCode} 已启用统计，但没有勾选任何供应商，跳过`)
      continue
    }
    // 时区取配置自己的州；为空时回落到所选供应商配置里第一个非 global 的州
    const regionCode =
      config.regionCode?.trim() && config.regionCode.trim() !== LEGACY_GLOBAL_SUPPLIER_REGION_CODE
        ? config.regionCode.trim()
        : (stationConfigs
            .map((c) => c.regionCode?.trim())
            .find((r) => !!r && r !== LEGACY_GLOBAL_SUPPLIER_REGION_CODE) ?? null)
    const supplierUnits = buildSupplierUnitIndex(stationConfigs)
    const scopes = supplierUnitsToScopes(supplierUnits)
    if (scopes.length === 0) continue
    targets.push({
      stationCode,
      regionCode,
      tz: resolveRegionTz(regionCode),
      settleTime: normalizeSettleTime(config.settleTime),
      scopes,
      supplierUnits,
      minSortingWaybills: config.minSortingWaybills ?? MIN_SORTING_WAYBILLS,
    })
  }
  return targets
}

export type SettleOneResult = {
  stationCode: string
  arrivalDate: string
  stage: SettleStage
  waybillCount: number
  cellCount: number
  /** 本次落库的格子，供调用方汇总展示，省得为了出一行摘要再查一次库 */
  cells: DispatchPerformanceCell[]
  /** 写库前复核发现这一趟已被另一条路径跑掉，本次什么都没做 */
  skipped: boolean
  /** 到件量低于该站点的开仓阈值：这天没开仓分拣，台账已盖章但一个格子都没写 */
  noBatch: boolean
}

/**
 * 结算单个 (站点, 到件日) 的某一趟。不判断窗口是否到期——由调用方按阶段决定，
 * 使两趟走同一条代码路径。
 *
 * 出仓趟传 rule=null，只算出仓、不碰派签：此刻窗口没到期，判出来的「未达标」全是
 * 「还没到期」，落库会把它当成最终值。
 */
/**
 * 拉一天的单并聚合成格子，**不落库**。手动「立刻统计」的派签试算复用它：
 * 试算只给人看，绝不能写进历史（提前于触发统计时间结算会把窗口尚未真正关闭的单记成未达标）。
 */
export async function computeOneArrivalDate(input: {
  token: string
  target: StationTarget
  arrivalDate: string
  stage: SettleStage
}): Promise<{
  cells: DispatchPerformanceCell[]
  supplierMeta: Map<string, { supplierName: string; vendorCode: string }>
  waybillCount: number
}> {
  const { token, target, arrivalDate, stage } = input
  const { stationCode, tz, regionCode, scopes, supplierUnits } = target

  // 强制重拉到件索引：缓存里那份可能是「到件日当天」被司机地图等写下的半截清单，
  // 之后永不刷新，直接用会让两个率的分母静默偏小且不回补。
  const fetched = await fetchDriverWaybills(token, {
    stationCode,
    dateStr: arrivalDate,
    regionCode,
    forceIndexRefresh: true,
  })
  if (!fetched.ok) throw new Error(`运单查询失败: ${fetched.message}`)

  const rows = fetched.data as Dispatch24hWaybillRow[]
  const cells = aggregateDispatchPerformanceCells({
    rows,
    stationCodes: [stationCode],
    rule: stage === 'dispatch' ? resolveDispatch24hWindowRule(arrivalDate, tz) : null,
    before11ThresholdMs: dispatchExitThresholdMs(arrivalDate, tz),
    sameDayExitThresholdMs: localDateTimeToMs(`${arrivalDate} 23:59:59`, tz),
    // 派签趟的结算时刻（O+1 11:00 / 周五批次下周一 23:59:59）恒不早于这个截止，无需另开一趟
    nextDayDeadlineMs: localDateTimeToMs(`${resolveExitDate(arrivalDate)} 23:59:59`, tz),
    scopes,
    priorityClientCodes: await loadPriorityClientCodes(),
    // 出仓趟不算钱（见 aggregateCells），省掉这一次查询
    priceBook: stage === 'dispatch' ? await loadPriceBook() : undefined,
  })

  const supplierMeta = new Map(
    [...supplierUnits.units.values()].map((unit) => [
      unit.supplierKey,
      { supplierName: unit.supplierName, vendorCode: unit.vendorCode },
    ]),
  )
  return { cells, supplierMeta, waybillCount: rows.length }
}

export async function settleOneArrivalDate(input: {
  token: string
  target: StationTarget
  arrivalDate: string
  stage: SettleStage
  /** 见 SaveCellsInput.provisional：派签趟仍会落库盖章，但标记成临时值，留给到点的定时结算覆盖 */
  provisional?: boolean
}): Promise<SettleOneResult> {
  const { target, arrivalDate, stage, provisional } = input

  // 写库前复核台账：cron 与「立刻统计」并行时，pending 列表是在对方写库之前算出来的。
  // 派签趟：本次是定时任务（非 provisional）时不能被「立刻统计」留下的临时章拦住——
  // 那正是本次要覆盖的权威结果；本次仍是手动跑时才把临时章也算「已完成」，不重复跑。
  const alreadyDone = await listSettledArrivalDates(target.stationCode, [arrivalDate], stage, {
    excludeProvisional: stage === 'dispatch' && !provisional,
  })
  if (alreadyDone.has(arrivalDate)) {
    return {
      stationCode: target.stationCode,
      arrivalDate,
      stage,
      waybillCount: 0,
      cellCount: 0,
      cells: [],
      skipped: true,
      noBatch: false,
    }
  }

  const { cells, supplierMeta, waybillCount } = await computeOneArrivalDate(input)

  // 这天没开仓分拣：到件量只有值班员工零星扫入库的几十单，两个率的分母小到毫无意义
  // （3 单里 1 单没出仓 = 33%），而结算不回补、落库即永久。落一条空台账把这天盖掉，
  // 不写任何格子 —— 下面那道「0 格子」检查也要让开，那几单碰巧属于所勾供应商时会有格子。
  const noBatch = isNoSortingBatch(waybillCount, target.minSortingWaybills)
  const cellsToSave = noBatch ? [] : cells
  if (noBatch) {
    console.warn(
      `${LABEL} station=${target.stationCode} date=${arrivalDate} 到件仅 ${waybillCount} 单` +
        `（< ${target.minSortingWaybills}），判定当天未开仓分拣，不写入统计`,
    )
  }

  // 拉到了运单却一个格子都没聚合出来 = 所选供应商与这天的实际承运商对不上（漏勾，
  // 或勾了别的站点的供应商）。这跟「这天本来就没货」是两回事，必须显式失败：
  // 抛在落库之前，既不写台账也不动既有数据，下一次 cron 或手动「立刻统计」还能重来。
  // 若静默写台账，按「每批只结算一次、不回补」的策略这天就被永久烧掉了。
  if (!noBatch && waybillCount > 0 && cells.length === 0) {
    throw new Error(
      `拉到 ${waybillCount} 单，但没有一单属于所选供应商 —— ` +
        '请在「出仓派签达成分析」的站点配置里检查勾选的供应商是否与该站点实际承运商一致',
    )
  }

  const cellCount = await saveDispatchPerformanceCells({
    arrivalDate,
    stationCode: target.stationCode,
    stage,
    cells: cellsToSave,
    supplierMeta,
    waybillCount,
    provisional,
  })

  return {
    stationCode: target.stationCode,
    arrivalDate,
    stage,
    waybillCount,
    cellCount,
    cells: cellsToSave,
    skipped: false,
    noBatch,
  }
}

/**
 * 某站点的结算时区：由该站点供应商配置的 regionCode 决定，与结算任务完全一致。
 * 路由层判断「这天是否已结算」必须用它，不能用登录用户所属州——两者在跨日边界可能差一天，
 * 会让尚未到期的批次被当成最终值算进去。站点未配置供应商时回落到默认时区。
 */
export async function resolveStationTz(stationCode: string): Promise<AusTz> {
  const targets = await resolveStationTargets()
  return targets.find((t) => t.stationCode === stationCode)?.tz ?? resolveRegionTz(null)
}

let settleChain: Promise<unknown> = Promise.resolve()

/**
 * 结算串行锁。
 *
 * cron 的 runDispatchPerformanceDailyStats 与「立刻统计」作业同在 worker 进程里各跑各的，
 * 作业队列只保证作业之间串行、拦不住 cron。两边对同一个 (station, arrivalDate) 做
 * delete+insert 会互相清数据：手动的出仓趟可能把 cron 刚落的四象限抹成 0，而台账上
 * dispatch_settled_at 已盖章、派签趟不会再跑，那天的派签率就永远停在「结算中」。
 *
 * 判重读台账也必须在锁内，否则拿到的是对方写库前的旧状态。
 */
export function withSettleLock<T>(fn: () => Promise<T>): Promise<T> {
  // 前一个环节成功或失败都继续排队，不让一次异常卡死整条链
  const next = settleChain.then(fn, fn)
  settleChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

let isRunning = false

/**
 * 由 scheduler 每分钟调用：只跑「此刻命中自己触发统计时间」的站点，把已到期但尚未落库的批次补齐。
 *
 * 触发时刻按各站点所属州的本地时间判定（见 settleTime.ts），所以同一分钟通常只有 0~1 个站点在跑。
 */
export async function runDispatchPerformanceDailyStats(): Promise<void> {
  if (isRunning) {
    // 每分钟触发一次，重入很正常：补跑窗口内的下一分钟会再来一次，不必告警
    return
  }
  isRunning = true
  try {
    const now = new Date()
    // 每分钟触发一次，绝大多数分钟无事可做：先用配置行自己的 regionCode 做便宜的到点粗筛，
    // 命中了再去 resolveStationTargets 拉全量供应商配置建索引。
    // regionCode 为空/global 时时区要靠所选供应商兜底，这里判不出来，一律放行走完整路径。
    const enabled = await listEnabledDispatchPerformanceConfigs()
    const maybeDue = enabled.some((c) => {
      const region = c.regionCode?.trim()
      if (!region || region === LEGACY_GLOBAL_SUPPLIER_REGION_CODE) return true
      return isSettleTriggerDue(c.settleTime, resolveRegionTz(region), now)
    })
    if (!maybeDue) return

    const allTargets = await resolveStationTargets()
    if (allTargets.length === 0) return

    const targets = allTargets.filter((t) => isSettleTriggerDue(t.settleTime, t.tz, now))
    if (targets.length === 0) return

    const token = await readDispatchPerformanceImileToken()
    if (!token) {
      console.warn(`${LABEL} 缺少 iMile token，跳过本次结算`)
      return
    }

    const nowMs = now.getTime()
    let settledCount = 0
    let failedCount = 0

    for (const target of targets) {
      // 派签趟先跑：落库是「先删后插」，谁后写谁说了算。同一天若两趟都待办（补跑时会发生），
      // 派签趟先跑并顺手盖上 exit_settled_at，下面的出仓趟就会被台账判重挡掉，
      // 不会用 rule=null 把刚补好的四象限清成 0。
      for (const stage of ['dispatch', 'exit'] as const) {
        // 不按星期几筛：周六/日临时开仓也是一批。开没开仓由到件量判定（见 settleOneArrivalDate 的 noBatch）
        const settled =
          stage === 'dispatch'
            ? resolveSettledArrivalDates(nowMs, target.tz)
            : resolveExitSettledArrivalDates(nowMs, target.tz)
        if (settled.length === 0) continue

        // 派签趟：cron 是权威结算，「立刻统计」留下的临时章（provisional）不算已完成，
        // 还在窗口内就要重跑一次覆盖成权威值——见 settleOneArrivalDate 的 alreadyDone 注释
        const done = await listSettledArrivalDates(target.stationCode, settled, stage, {
          excludeProvisional: stage === 'dispatch',
        })
        const pending = settled.filter((date) => !done.has(date))
        if (pending.length === 0) continue

        // 只跑「刚到期」的：过期批次不回补，因为按日期拉运单读到的是单据当前状态，
        // 退回仓库后重新派送的单会把第二次派送的司机和时间记进原到件日。
        const due = new Set(
          stage === 'dispatch'
            ? resolveDispatchDueArrivalDates(nowMs, target.tz)
            : resolveExitDueArrivalDates(nowMs, target.tz),
        )
        const toSettle = pending.filter((date) => due.has(date))
        const skipped = pending.filter((date) => !due.has(date))

        if (skipped.length > 0) {
          console.warn(
            `${LABEL} station=${target.stationCode} stage=${stage} 已过期不回补=[${skipped.join(',')}]` +
              '（新站点首次启用、或该批到期时任务没跑成功；回补会读到退仓重派后的状态，故放弃）',
          )
        }
        if (toSettle.length === 0) continue

        console.log(
          `${LABEL} station=${target.stationCode} stage=${stage} 待结算到件日=[${toSettle.join(',')}] suppliers=${target.scopes.length}`,
        )

        for (const arrivalDate of toSettle) {
          try {
            const result = await withSettleLock(() =>
              settleOneArrivalDate({ token, target, arrivalDate, stage }),
            )
            settledCount += 1
            console.log(
              `${LABEL} ✓ station=${result.stationCode} date=${result.arrivalDate} stage=${stage} waybills=${result.waybillCount} cells=${result.cellCount}`,
            )
          } catch (err) {
            // 单个批次失败不影响其余批次；本次不记台账，下次 cron 会重新纳入待结算
            failedCount += 1
            const msg = err instanceof Error ? err.message : String(err)
            console.error(
              `${LABEL} ✗ station=${target.stationCode} date=${arrivalDate} stage=${stage}: ${msg}`,
            )
          }
        }
      }
    }

    // 每分钟触发，没结算任何东西时不留日志，否则补跑窗口内每分钟一行噪声
    if (settledCount + failedCount > 0) {
      console.log(`${LABEL} 本次结算完成 成功=${settledCount} 失败=${failedCount}`)
    }
  } catch (err) {
    console.error(`${LABEL} 结算任务异常:`, err)
  } finally {
    isRunning = false
  }
}

/** worker 启动自检，便于排查「到点没跑」 */
export async function logDispatchPerformanceReadiness(cronExpr: string): Promise<void> {
  try {
    const token = await readDispatchPerformanceImileToken()
    const targets = await resolveStationTargets()
    console.log(
      `${LABEL} 就绪 cron="${cronExpr}" stations=[${targets
        .map((t) => `${t.stationCode}@${t.settleTime}/${t.tz}`)
        .join(',')}] token=${token ? 'ok' : 'missing'}`,
    )
    if (!token) {
      console.warn(
        `${LABEL} 缺少 iMile token，请在「系统设置」里配置，或设置 IMILE_DISPATCH_PERFORMANCE_TOKEN 兜底`,
      )
    }
    if (targets.length === 0) {
      console.warn(`${LABEL} 尚无已启用的站点配置，等待在「出仓派签达成分析」页面添加后生效`)
    }
  } catch (err) {
    console.error(`${LABEL} 启动自检失败:`, err)
  }
}
