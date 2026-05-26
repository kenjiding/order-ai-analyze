/** 解析文本中的订单号：支持换行、中英文逗号、空格分隔，去重保序 */
export function parseOrderNumbersUnique(raw: string): string[] {
  const parts = raw
    .split(/[\s,;，；、]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}
