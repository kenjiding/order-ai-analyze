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

export type ExitAlarmWaybillRow = {
  deliveryTime?: string | null
  consigneeRouteCode?: string | null
}

/** 出仓告警：pending = 未在 11 点前出仓（含无派件时间、派件晚于 11 点） */
export function buildExitAlarmZoneBreakdown(
  waybills: ExitAlarmWaybillRow[],
  before11ThresholdMs: number,
): Record<string, { pending: number; total: number }> {
  const zoneBreakdown: Record<string, { pending: number; total: number }> = {}
  for (const w of waybills) {
    const zone = (w.consigneeRouteCode ?? '').trim() || 'Unknown route'
    if (!zoneBreakdown[zone]) zoneBreakdown[zone] = { pending: 0, total: 0 }
    zoneBreakdown[zone].total++
    if (!isBefore11Exit(w.deliveryTime, before11ThresholdMs)) {
      zoneBreakdown[zone].pending++
    }
  }
  return zoneBreakdown
}
