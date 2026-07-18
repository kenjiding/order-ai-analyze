import { iMileStrToMs, type AusTz } from './ausTimezone'
import { localToUtcMs } from './inboundWaybillIndex'

/**
 * 到件日 dateStr 的次日 11:00:00（账号州时区）对应的 UTC 毫秒。
 * dateStr 一般为「昨天」；与供应商分析 before11ExitRate 口径一致。
 */
export function computeBefore11ThresholdMs(dateStr: string, tz: AusTz): number {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const nextDayStr = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10)
  return localToUtcMs(`${nextDayStr} 11:00:00`, tz)
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
