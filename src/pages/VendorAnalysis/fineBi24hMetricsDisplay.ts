/** FineBI 派签率 formatText 转百分比数值，用于排序与颜色阈值 */
export function parseDispatchRatePercentFromFormatText(formatText: string | null): number | null {
  if (!formatText?.trim()) return null
  const cleaned = formatText.trim().replace(/,/g, '').replace(/%$/, '')
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return n <= 1 ? n * 100 : n
}

export function dispatchRate24hColor(formatText: string | null): 'green' | 'orange' | 'red' | 'grey' {
  const pct = parseDispatchRatePercentFromFormatText(formatText)
  if (pct == null) return 'grey'
  if (pct >= 98) return 'green'
  if (pct >= 95) return 'orange'
  return 'red'
}
