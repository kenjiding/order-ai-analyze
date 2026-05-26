/** 与扫描行、筛选条件一致：去首尾空白，中间连续空白压成单空格 */
function normRouteMatchKey(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

/**
 * 从表单原文解析多个路由编码：支持空格、换行、英文逗号、中文逗号分隔；去重保留顺序。
 */
export function parseFleetRouteCodes(raw: string): string[] {
  const t = raw.trim()
  if (!t) return []

  const tokens = t
    .split(/[\s,，]+/u)
    .map((p) => normRouteMatchKey(p))
    .filter(Boolean)

  const seen = new Set<string>()
  const out: string[] = []
  for (const token of tokens) {
    const key = normRouteMatchKey(token)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export function normFleetRouteCodeForMatch(s: string): string {
  return normRouteMatchKey(s)
}
