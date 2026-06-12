function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase()
}

function hasCellValue(v: unknown): boolean {
  return v !== undefined && v !== null && String(v).trim() !== ''
}

/** 支持「中文/English」合并表头与模糊列名匹配 */
export function cellValueFromSheetRow(
  row: Record<string, unknown>,
  candidates: readonly string[],
): unknown {
  for (const key of candidates) {
    const v = row[key]
    if (hasCellValue(v)) return v
  }

  const normalizedCandidates = candidates.map(normalizeHeader).filter(Boolean)
  const entries = Object.entries(row)

  for (const [rowKey, v] of entries) {
    if (!hasCellValue(v)) continue
    const normalizedRowKey = normalizeHeader(rowKey)
    for (const cand of normalizedCandidates) {
      if (normalizedRowKey === cand) return v
    }
    const segments = String(rowKey)
      .split('/')
      .map((part) => normalizeHeader(part))
      .filter(Boolean)
    for (const cand of normalizedCandidates) {
      if (segments.some((seg) => seg === cand)) return v
    }
  }

  for (const [rowKey, v] of entries) {
    if (!hasCellValue(v)) continue
    const normalizedRowKey = normalizeHeader(rowKey)
    for (const cand of normalizedCandidates) {
      if (normalizedRowKey.includes(cand) || cand.includes(normalizedRowKey)) return v
    }
  }

  return null
}

export function cellStringFromSheetRow(
  row: Record<string, unknown>,
  keys: readonly string[],
): string {
  const v = cellValueFromSheetRow(row, keys)
  return v == null ? '' : String(v).trim()
}
