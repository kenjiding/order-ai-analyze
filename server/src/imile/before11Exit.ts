import { iMileStrToMs, type AusTz } from './ausTimezone'
import { localToUtcMs } from './inboundWaybillIndex'
import { nextSortingWorkdayAfter } from './sortingWorkday'

/** 给定本地日历日 dateStr 当天 timeHHmm（账号州时区）对应的 UTC 毫秒——不做任何日期推导，dateStr 由调用方给准。 */
export function computeThresholdMsOnDate(dateStr: string, tz: AusTz, timeHHmm: string): number {
  return localToUtcMs(`${dateStr} ${timeHHmm}:00`, tz)
}

/**
 * 到件日 dateStr 的出仓日 11:00（账号州时区）对应的 UTC 毫秒。
 * 出仓日 = 下一个分拣工作日：周一～周四为次日，周五/六/日为下周一。
 *
 * 出仓告警不用这个函数，而是直接用推送触发当天调用 computeThresholdMsOnDate
 * （见 exitAlarmScheduledPush.ts）。本函数给「供应商数据分析」与「出仓派签达成分析」用。
 */
export function computeBefore11ThresholdMs(dateStr: string, tz: AusTz): number {
  return computeThresholdMsOnDate(nextSortingWorkdayAfter(dateStr), tz, '11:00')
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
