/** 菜鸟件：运单号（去首尾空白后）以 3 开头。与货量统计使用同一运单号字段。 */
export function isCainiaoWaybill(waybill: string): boolean {
  const s = waybill.trim()
  if (!s || s.startsWith('__row_')) return false
  return s.startsWith('3')
}

/** 0–1 占比 → 展示用百分比文本 */
export function formatCainiaoSharePercent(share: number | null | undefined, digits = 1): string {
  if (share == null || !Number.isFinite(share)) return '—'
  return `${(share * 100).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`
}
