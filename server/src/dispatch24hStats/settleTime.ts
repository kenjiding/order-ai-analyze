/**
 * 「触发统计时间」：每条站点配置自己决定几点跑结算，按该站点所属州的本地时间。
 *
 * 调度器每分钟扫一遍全部启用中的配置（cron `* * * * *`），本模块判定某站点此刻是否该跑。
 * 命中后落不落库仍由结算台账 + SETTLE_DUE_WINDOW_MS 决定，所以重复命中是安全的 ——
 * 也正因为安全，这里给了 CATCH_UP_MINUTES 的补跑窗口：worker 在触发那一分钟正忙于
 * 拉别的站点时，下一分钟还能补上，不至于整天丢掉。
 */
import type { AusTz } from '../imile/ausTimezone'
import { getRegionNow } from '../imile/inboundWaybillIndex'

/** 默认 16:00：出仓阈值 11:00 与 24h 派签窗口的上界都已过，不会把「窗口还没到期」记成未达标 */
export const DEFAULT_SETTLE_TIME = '16:00'

/**
 * 触发时刻之后还允许补跑的分钟数，覆盖 worker 恰好在那一分钟忙着的情况。
 * 与定时推送的补跑窗口取同一个 15 分钟口径（jobs/scheduledDueSlots.ts）。
 */
export const SETTLE_CATCH_UP_MINUTES = 15

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidSettleTime(raw: unknown): boolean {
  return typeof raw === 'string' && HHMM_RE.test(raw.trim())
}

/** 脏数据（历史行、手工改库）不该让整个站点静默停摆，回落默认值 */
export function normalizeSettleTime(raw: unknown): string {
  const value = String(raw ?? '').trim()
  return HHMM_RE.test(value) ? value : DEFAULT_SETTLE_TIME
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 站点本地时间是否落在 [settleTime, settleTime + 补跑窗口) 内 */
export function isSettleTriggerDue(settleTime: string, tz: AusTz, now: Date = new Date()): boolean {
  const nowMin = minutesOfDay(getRegionNow(tz, now).timeHHmm)
  // 跨午夜：23:30 触发、本地 00:10 仍算补跑窗口内
  const elapsed = (nowMin - minutesOfDay(normalizeSettleTime(settleTime)) + 1440) % 1440
  return elapsed < SETTLE_CATCH_UP_MINUTES
}
