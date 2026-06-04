import type { ScannerEfficiencyResult } from './aggregates'

export const normalizeScannerKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()

/**
 * 为扫描员列注册查找别名：整段、按空白/逗号等切分后的片段，以及「-」分层 ID 的末段
 *（如 ADL-DC-Abc 与考勤「昵称」Abc 对应；键比较时仍经 {@link normalizeScannerKey} 归一化）。
 */
const putAliases = (scannerLabel: string, put: (key: string) => void) => {
  const s = String(scannerLabel ?? '').trim()
  if (!s) return

  const registerFragment = (fragment: string) => {
    const t = fragment.trim()
    if (!t) return
    put(t)
    const segs = t.split('-').map((p) => p.trim()).filter(Boolean)
    if (segs.length >= 2) {
      const last = segs[segs.length - 1]!
      if (last.length >= 2 && last.toLowerCase() !== t.toLowerCase()) {
        put(last)
      }
    }
  }

  registerFragment(s)
  s.split(/[\s,，/\\|、]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p !== s)
    .forEach(registerFragment)
}

export const buildSortingEfficiencyLookup = (scannerResult: ScannerEfficiencyResult | null): Map<string, number> => {
  const map = new Map<string, number>()
  if (!scannerResult?.scannerTotalRows?.length) return map
  const putEff = (key: string, eff: number) => {
    const k = normalizeScannerKey(key)
    if (k && !map.has(k)) map.set(k, eff)
  }
  scannerResult.scannerTotalRows.forEach((row) => {
    // 与「扫描员一级分拣效率汇总」口径一致，人员侧优先展示修正效率。
    const eff = row.adjustedEfficiency
    putAliases(row.scanner, (key) => putEff(key, eff))
  })
  return map
}

/** 一级分拣同源个人总扫描量；键规则与 {@link buildSortingEfficiencyLookup} 一致 */
export const buildSortingScanCountLookup = (scannerResult: ScannerEfficiencyResult | null): Map<string, number> => {
  const map = new Map<string, number>()
  if (!scannerResult?.scannerTotalRows?.length) return map
  const putCount = (key: string, n: number) => {
    const k = normalizeScannerKey(key)
    if (k && !map.has(k)) map.set(k, n)
  }
  scannerResult.scannerTotalRows.forEach((row) => {
    const n = row.scanCount
    putAliases(row.scanner, (key) => putCount(key, n))
  })
  return map
}

export type PersonRowForSorting = {
  sorterName: string
  sorterKey: string
  efficiencyMatchNames?: string[]
}

export const sortingEfficiencyForPerson = (
  personRow: PersonRowForSorting,
  lookup: Map<string, number>,
): number | '' => {
  if (!lookup.size) return ''
  const tryKey = (raw: string): number | null => {
    const n = normalizeScannerKey(raw)
    if (n && lookup.has(n)) return Number(lookup.get(n)!.toFixed(2))
    return null
  }
  const nameSet = new Set<string>()
  ;[personRow.sorterName, personRow.sorterKey, ...(personRow.efficiencyMatchNames || [])].forEach((x) => {
    if (x) nameSet.add(String(x).trim())
  })
  for (const c of nameSet) {
    if (!c) continue
    const fromFull = tryKey(c)
    if (fromFull != null) return fromFull
    const parts = c
      .split(/[\s,，/\\|、]+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 2)
    for (const p of parts) {
      const fromPart = tryKey(p)
      if (fromPart != null) return fromPart
    }
  }
  return ''
}

export const sortingScanCountForPerson = (
  personRow: PersonRowForSorting,
  lookup: Map<string, number>,
): number | '' => {
  if (!lookup.size) return ''
  const tryKey = (raw: string): number | null => {
    const n = normalizeScannerKey(raw)
    if (n && lookup.has(n)) return lookup.get(n)!
    return null
  }
  const nameSet = new Set<string>()
  ;[personRow.sorterName, personRow.sorterKey, ...(personRow.efficiencyMatchNames || [])].forEach((x) => {
    if (x) nameSet.add(String(x).trim())
  })
  for (const c of nameSet) {
    if (!c) continue
    const fromFull = tryKey(c)
    if (fromFull != null) return fromFull
    const parts = c
      .split(/[\s,，/\\|、]+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 2)
    for (const p of parts) {
      const fromPart = tryKey(p)
      if (fromPart != null) return fromPart
    }
  }
  return ''
}

export const sortingAverageEfficiencyValue = (scannerResult: ScannerEfficiencyResult | null): number | '' => {
  const v = scannerResult?.summary?.totalEfficiency
  if (typeof v !== 'number' || !Number.isFinite(v)) return ''
  return Number(v.toFixed(2))
}

/** 指定统计日的一级分拣效率（票/小时） */
export const sortingEfficiencyForDate = (
  scannerResult: ScannerEfficiencyResult | null,
  planDate: string,
): number | '' => {
  const row = scannerResult?.dailySummaryRows.find((item) => item.date === planDate)
  if (!row || row.effectiveHours <= 0 || !Number.isFinite(row.efficiency)) return ''
  return Number(row.efficiency.toFixed(2))
}
