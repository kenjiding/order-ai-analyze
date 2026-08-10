import { iMileStrToMs, type AusTz } from './ausTimezone'
import { localToUtcMs } from './inboundWaybillIndex'

/** 给定本地日历日 dateStr 当天 timeHHmm（账号州时区）对应的 UTC 毫秒——不做任何日期推导，dateStr 由调用方给准。 */
export function computeThresholdMsOnDate(dateStr: string, tz: AusTz, timeHHmm: string): number {
  return localToUtcMs(`${dateStr} ${timeHHmm}:00`, tz)
}

/**
 * 到件日 dateStr 的日历次日 timeHHmm（账号州时区）对应的 UTC 毫秒。
 *
 * 仅在「到件日 = 昨天」成立时，「到件日 + 1 天」才等于「今天」；到件日因跨周末/节假日被
 * lastSortingWorkdayOnOrBefore 回退超过 1 天时（如周一取上周五到件），这里推出的日期会
 * 落在一个早已过去的非工作日（如周六），而非推送实际发生的那天——出仓告警不用这个函数，
 * 而是直接用推送触发当天的日期调用 computeThresholdMsOnDate（见 exitAlarmScheduledPush.ts）。
 * 本函数只保留给「供应商数据分析」的 before11ExitRate 使用，維持其既有口径不变。
 */
export function computeBefore11ThresholdMs(dateStr: string, tz: AusTz): number {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const nextDayStr = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10)
  return computeThresholdMsOnDate(nextDayStr, tz, '11:00')
}

/** 派件时间（墨尔本本地）≤ 阈值即 11 点前出仓；空派件时间视为未达标 */
export function isBefore11Exit(
  deliveryTime: string | null | undefined,
  before11ThresholdMs: number,
): boolean {
  if (!deliveryTime) return false
  return iMileStrToMs(deliveryTime) <= before11ThresholdMs
}

// 出仓告警的分区聚合已并入 vendorAnalysis/before11Aggregate（projectBefore11ZoneBreakdown），
// 与「供应商数据分析」共用同一套过滤 + 打标核心；本文件只保留阈值/单件判定原语。
