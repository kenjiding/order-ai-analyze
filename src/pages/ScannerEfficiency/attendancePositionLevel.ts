export function normalizePositionTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 从职位名称或编号解析 level（如 level 2-30 → 30，level_28 → 28，职位编号 28 → 28） */
export function extractPositionLevel(
  positionTitle?: string,
  positionCode?: string,
): number | null {
  const title = normalizePositionTitle(positionTitle ?? '')
  const hyphenMatch = title.match(/level[\s_-]*(\d+)[\s_-]+(\d+)/)
  if (hyphenMatch) return Number(hyphenMatch[2])
  const simpleMatch = title.match(/level[\s_-]*(\d+)/)
  if (simpleMatch) return Number(simpleMatch[1])
  const codeDigits = String(positionCode ?? '').match(/\d+/)?.[0]
  if (codeDigits) return Number(codeDigits)
  return null
}

export function isPositionLevel(
  row: { positionTitle?: string; positionCode?: string },
  level: number,
): boolean {
  return extractPositionLevel(row.positionTitle, row.positionCode) === level
}
