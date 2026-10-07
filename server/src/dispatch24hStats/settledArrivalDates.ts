/**
 * 「哪些到件批次已经可以结算」的日历推导，**两个指标各有各的时机**。
 *
 * 到件日 D 的一批货，两个指标定终值的时间差一天：
 * - **11点前出仓**：出仓日 O 当天 11:00 定终值（见 resolveExitDate）。周一～周四 O = D+1，
 *   周五/六/日到件 O = 下周一。运行日结算「出仓阈值刚过」的那批。
 * - **24小时派签**：窗口按 D 判（见 resolveDispatch24hWindowRule），滚动批次最迟到 O+1 的
 *   11:00（因为出仓 ≤ 11:00），固定截止批次到下周一 23:59:59。典型即 D+2，运行日结算
 *   「前天到件」那批。**不能提前算**——窗口没到期时包裹会被归班盘点重新派出，统计会乱。
 *
 * 派签的 D → 运行日映射（周四那批因出仓在周五、窗口到周六）：
 *   周一→周三  周二→周四  周三→周五  周四→周六  周五/周六/周日→下周二
 * 反过来运行日周一、周日无可结算的派签批次。
 *
 * 两套导出各有用途，别混用：
 * - `resolve*SettledArrivalDates` = 纯「已到期」判断，回看窗口内全部命中。路由层用它标注
 *   前端「这天是否已结算」，必须保持这个语义。
 * - `resolve*DueArrivalDates` = 「刚到期」，多一层 SETTLE_DUE_WINDOW_MS 过滤。结算任务只能用它，
 *   过期即弃、不回补（原因见该常量的注释）。
 */
import { localDateTimeToMs, type AusTz } from '../imile/ausTimezone'
import type { RegionCalendarOverrides } from '../imile/sortingWorkday'
import { resolveDispatch24hWindowRule, resolveExitDate } from '../vendorAnalysis/dispatch24hAggregate'

const DAY_MS = 24 * 60 * 60 * 1000

/** 默认回看天数：够覆盖「周五到件 → 下周二结算」的最长跨度，并让结算任务能发现自己漏跑了哪天 */
export const DEFAULT_SETTLE_LOOKBACK_DAYS = 10

/**
 * 结算任务只处理「刚到期」的批次：settle 时刻距今在这个窗口内才结算，过期即弃、不回补。
 *
 * 50h ≈ 两次每日触发 + 余量：每个站点每天只在自己的 settleTime 跑一次，26h 的旧口径意味着
 * 那一次失败（iMile 抖动 / token 过期 / 恰好在部署重启窗口）这天就永久没数据，
 * 连「立刻统计」都救不回来（走同一套 due 判定）。50h 给了整整一次次日重试的机会。
 *
 * **为什么不放得更宽**：按日期拉运单拿到的是该批单号的「当前状态」（courier / deliveryTime /
 * signDate）。被退回仓库、隔几天重新派送的单，回补时读到的是第二次派送的司机和时间，
 * 却被记进原到件日名下 —— 回补跑得越远错配越多。隔一天重试读到的状态基本一致，再远就不值了。
 */
export const SETTLE_DUE_WINDOW_MS = 50 * 60 * 60 * 1000

/** 出仓指标定终值的时刻：出仓日 O 当天 11:00 */
export function exitBatchSettleMs(
  arrivalDateStr: string,
  tz: AusTz,
  overrides: RegionCalendarOverrides = new Map(),
): number {
  return localDateTimeToMs(`${resolveExitDate(arrivalDateStr, overrides)} 11:00:00`, tz)
}

/**
 * 到件日 D 的批次「全部单据窗口都已到期」的时刻（UTC 毫秒）。
 *
 * 滚动批次用 `出仓日 11:00 + 24h` 作为上界——出仓晚于 11 点的单本就违反「11点前出仓」，
 * 其真实窗口会更晚，这里按上界结算意味着它们被记为未达标，与该指标的约束方向一致。
 */
export function dispatchBatchSettleMs(
  arrivalDateStr: string,
  tz: AusTz,
  overrides: RegionCalendarOverrides = new Map(),
): number {
  const rule = resolveDispatch24hWindowRule(arrivalDateStr, tz, overrides)
  if (rule.kind === 'fixedDeadline') return rule.deadlineMs
  return exitBatchSettleMs(arrivalDateStr, tz, overrides) + DAY_MS
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const cur = new Date(Date.UTC(y, m - 1, d))
  cur.setUTCDate(cur.getUTCDate() + days)
  return cur.toISOString().slice(0, 10)
}

/** 某 UTC 时刻在 tz 的本地日历日 YYYY-MM-DD */
function localDate(nowMs: number, tz: AusTz): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs))
}

function collectSettled(
  nowMs: number,
  tz: AusTz,
  lookbackDays: number,
  settleMsOf: (arrivalDate: string, tz: AusTz, overrides: RegionCalendarOverrides) => number,
  overrides: RegionCalendarOverrides,
  /** 给定时只保留 settle 时刻落在最近这段时间内的批次（结算任务用），不给则返回全部已到期的 */
  dueWithinMs?: number,
): string[] {
  const today = localDate(nowMs, tz)
  const settled: string[] = []
  for (let back = lookbackDays; back >= 1; back -= 1) {
    const arrivalDate = shiftDate(today, -back)
    const settleMs = settleMsOf(arrivalDate, tz, overrides)
    if (nowMs <= settleMs) continue
    if (dueWithinMs != null && nowMs - settleMs > dueWithinMs) continue
    settled.push(arrivalDate)
  }
  return settled
}

/**
 * 截至 nowMs，**出仓**指标已定终值的到件日列表（升序）。典型是「昨天」及更早。
 * 周末同样纳入：周六/日临时开仓也是一批（截止与周五一致），没开仓的日子由到件量判定跳过。
 */
export function resolveExitSettledArrivalDates(
  nowMs: number,
  tz: AusTz,
  lookbackDays: number = DEFAULT_SETTLE_LOOKBACK_DAYS,
  overrides: RegionCalendarOverrides = new Map(),
): string[] {
  return collectSettled(nowMs, tz, lookbackDays, exitBatchSettleMs, overrides)
}

/**
 * 截至 nowMs，**派签**窗口已全部到期的到件日列表（升序）。典型是「前天」及更早。
 * 比 resolveExitSettledArrivalDates 晚一天解锁——这一天的差正是两趟结算存在的原因。
 */
export function resolveSettledArrivalDates(
  nowMs: number,
  tz: AusTz,
  lookbackDays: number = DEFAULT_SETTLE_LOOKBACK_DAYS,
  overrides: RegionCalendarOverrides = new Map(),
): string[] {
  return collectSettled(nowMs, tz, lookbackDays, dispatchBatchSettleMs, overrides)
}

/**
 * 出仓指标**刚到期**的到件日：结算任务真正该跑的那一批。
 * 与 resolveExitSettledArrivalDates 的差集 = 漏跑且已过期、不再回补的批次。
 */
export function resolveExitDueArrivalDates(
  nowMs: number,
  tz: AusTz,
  lookbackDays: number = DEFAULT_SETTLE_LOOKBACK_DAYS,
  overrides: RegionCalendarOverrides = new Map(),
): string[] {
  return collectSettled(nowMs, tz, lookbackDays, exitBatchSettleMs, overrides, SETTLE_DUE_WINDOW_MS)
}

/** 派签窗口**刚到期**的到件日：结算任务真正该跑的那一批。 */
export function resolveDispatchDueArrivalDates(
  nowMs: number,
  tz: AusTz,
  lookbackDays: number = DEFAULT_SETTLE_LOOKBACK_DAYS,
  overrides: RegionCalendarOverrides = new Map(),
): string[] {
  return collectSettled(nowMs, tz, lookbackDays, dispatchBatchSettleMs, overrides, SETTLE_DUE_WINDOW_MS)
}
