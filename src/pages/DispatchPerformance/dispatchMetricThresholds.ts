/**
 * 达成率考核阈值 + 「平均/总单量」格式化：明细表与数据推送预览共用同一份，避免口径漂移。
 * 单独一个文件（而非留在 PerformanceBreakdownTable.tsx 里）是因为 react-refresh 的
 * only-export-components 规则不允许组件文件里混出非组件的值。
 */
export const BEFORE11_ALERT_PCT = 95
export const BEFORE11_TARGET_PCT = 99
export const SIGN_ALERT_PCT = 92
export const SIGN_TARGET_PCT = 95

/** dayCount<=0（无有效天数）时退化为只显示总量 */
export function formatAvgTotal(total: number, dayCount: number): string {
  return dayCount > 0 ? `${Math.round(total / dayCount)}/${total}` : `${total}`
}

export function rateColor(rate: number | null, alertPct?: number, targetPct?: number): string {
  if (rate == null) return 'text-slate-300'
  // 没有考核目标的指标（当天出仓率）不着色
  if (alertPct == null || targetPct == null) return 'text-slate-700'
  if (rate < alertPct) return 'text-red-600'
  if (rate < targetPct) return 'text-amber-600'
  return 'text-emerald-600'
}
