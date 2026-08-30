/**
 * 出仓派签达成分析的每日结算任务，**分两趟**。
 *
 * 两个指标定终值的时间差一天，不能等到同一刻一起算：
 * - **出仓趟**：结算「昨天到件」那批（D = T-1）。出仓日 O 的 11:00 阈值一过就定终值。
 * - **派签趟**：结算「前天到件」那批（D = T-2）。必须等 24h 窗口到期——提前算的话，
 *   包裹会被归班盘点重新派给派送员，统计就乱了。
 *
 * 同一个到件日 D 因此被写两次：D+1 写出仓，D+2 完整重算并补上派签与四象限。
 * 有没有批次可结算由日历决定（见 settledArrivalDates），所以 cron 不必编码星期。
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
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { isSettleTriggerDue, normalizeSettleTime } from './settleTime'
import { fetchDriverWaybills } from '../imile/driverPerformance'
import { getGlobalImileToken } from '../feishu/globalImileToken'
import { envFirst, normalizeImileToken } from '../imile/shared'
import {
  dispatchExitThresholdMs,
  resolveDispatch24hWindowRule,
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
import {
  listSettledArrivalDates,
  saveDispatchPerformanceCells,
  type SettleStage,
} from './repository'
import {
  isWorkdayArrival,
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

  const fetched = await fetchDriverWaybills(token, { stationCode, dateStr: arrivalDate, regionCode })
  if (!fetched.ok) throw new Error(`运单查询失败: ${fetched.message}`)

  const rows = fetched.data as Dispatch24hWaybillRow[]
  const cells = aggregateDispatchPerformanceCells({
    rows,
    stationCodes: [stationCode],
    rule: stage === 'dispatch' ? resolveDispatch24hWindowRule(arrivalDate, tz) : null,
    before11ThresholdMs: dispatchExitThresholdMs(arrivalDate, tz),
    scopes,
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
  /** 见 SaveCellsInput.provisional：落库但不给派签盖章，留给到点的定时结算覆盖 */
  provisional?: boolean
}): Promise<SettleOneResult> {
  const { target, arrivalDate, stage, provisional } = input
  const { cells, supplierMeta, waybillCount } = await computeOneArrivalDate(input)

  // 拉到了运单却一个格子都没聚合出来 = 所选供应商与这天的实际承运商对不上（漏勾，
  // 或勾了别的站点的供应商）。这跟「这天本来就没货」是两回事，必须显式失败：
  // 抛在落库之前，既不写台账也不动既有数据，下一次 cron 或手动「立刻统计」还能重来。
  // 若静默写台账，按「每批只结算一次、不回补」的策略这天就被永久烧掉了。
  if (waybillCount > 0 && cells.length === 0) {
    throw new Error(
      `拉到 ${waybillCount} 单，但没有一单属于所选供应商 —— ` +
        '请在「出仓派签达成分析」的站点配置里检查勾选的供应商是否与该站点实际承运商一致',
    )
  }

  const cellCount = await saveDispatchPerformanceCells({
    arrivalDate,
    stationCode: target.stationCode,
    stage,
    cells,
    supplierMeta,
    waybillCount,
    provisional,
  })

  return { stationCode: target.stationCode, arrivalDate, stage, waybillCount, cellCount, cells }
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
      // 派签趟先跑：它结算的是更早的批次，会把出仓趟先前写下的那一天整体覆盖成完整数据。
      // 反过来先跑出仓趟的话，同一天若两趟都待办（比如补跑），出仓趟会把刚补好的派签结果冲掉。
      for (const stage of ['dispatch', 'exit'] as const) {
        // 周末不开仓分拣、没有到件批次，不为它去 iMile 空拉一次
        const settled = (
          stage === 'dispatch'
            ? resolveSettledArrivalDates(nowMs, target.tz)
            : resolveExitSettledArrivalDates(nowMs, target.tz)
        ).filter(isWorkdayArrival)
        if (settled.length === 0) continue

        const done = await listSettledArrivalDates(target.stationCode, settled, stage)
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
            const result = await settleOneArrivalDate({ token, target, arrivalDate, stage })
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
