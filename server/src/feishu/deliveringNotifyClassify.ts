/** 无派件时间且末次扫描为取消扫描(1504)或 400：司机因包裹过大未取 */
export const OVERSIZED_UNCOLLECTED_SCAN_CODES = new Set(['1504', '400'])

export type DeliveringNotifyKind = 'outForDelivery' | 'oversizedUncollected' | 'skip'

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/**
 * 仓前台扫码通知口径：
 * - 有派件时间且未签收 → 正在派送（系统已 dispatch，仍在仓）
 * - 无派件时间且 lastScanStatusCode 为 1504/400 → 超大件，司机未取
 * - 其余（已签收、对不上两类）→ 不推送
 */
export function classifyDeliveringNotifyWaybill(row: {
  deliveryTime?: unknown
  signDate?: unknown
  lastScanStatusCode?: unknown
}): DeliveringNotifyKind {
  if (text(row.signDate)) return 'skip'
  if (text(row.deliveryTime)) return 'outForDelivery'
  const scanCode = text(row.lastScanStatusCode)
  if (OVERSIZED_UNCOLLECTED_SCAN_CODES.has(scanCode)) return 'oversizedUncollected'
  return 'skip'
}
