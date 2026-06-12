import type { AttendanceEfficiencyResult, ScannerEfficiencyResult } from './aggregates'

export const MIN_SCANNER_NICKNAME_FUZZY_LEN = 2

export const normalizeScannerKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()

/** 扫描员编码末段，如 ADL-DC-Serene → Serene */
export function extractScannerTail(label: string): string {
  const s = String(label ?? '').trim()
  if (!s) return ''
  const segs = s.split('-').map((p) => p.trim()).filter(Boolean)
  return segs.length >= 2 ? segs[segs.length - 1]! : s
}

/**
 * 考勤「昵称」↔ 扫描件「扫描员」匹配得分；越高越优先，-1 表示不匹配。
 * 规则：忽略大小写；全段或末段精确相等；或互为前缀（如 pan ↔ PanPan）。
 */
export function scoreScannerNicknameMatch(scannerLabel: string, nickname: string): number {
  const nick = normalizeScannerKey(nickname)
  if (!nick || nick.length < MIN_SCANNER_NICKNAME_FUZZY_LEN) return -1

  const full = normalizeScannerKey(scannerLabel)
  if (full && full === nick) return 1000 + nick.length

  const tail = normalizeScannerKey(extractScannerTail(scannerLabel))
  if (!tail) return -1
  if (tail === nick) return 900 + nick.length
  if (tail.startsWith(nick)) return 500 + nick.length
  if (nick.startsWith(tail) && tail.length >= MIN_SCANNER_NICKNAME_FUZZY_LEN) {
    return 400 + tail.length
  }
  return -1
}

export function scannerNicknameMatches(scannerLabel: string, nickname: string): boolean {
  return scoreScannerNicknameMatch(scannerLabel, nickname) >= 0
}

export type PersonRowForSorting = {
  sorterName: string
  sorterKey: string
  efficiencyMatchNames?: string[]
}

function collectPersonMatchLabels(person: PersonRowForSorting): string[] {
  const out = new Set<string>()
  ;[person.sorterName, person.sorterKey, ...(person.efficiencyMatchNames ?? [])].forEach((x) => {
    const t = String(x ?? '').trim()
    if (t) out.add(t)
  })
  return Array.from(out)
}

function findBestScannerRowForPerson(
  personRow: PersonRowForSorting,
  scannerRows: ScannerEfficiencyResult['scannerTotalRows'],
) {
  const labels = collectPersonMatchLabels(personRow)
  let best: (typeof scannerRows)[number] | null = null
  let bestScore = -1
  for (const row of scannerRows) {
    for (const label of labels) {
      const score = scoreScannerNicknameMatch(row.scanner, label)
      if (score > bestScore) {
        bestScore = score
        best = row
      }
    }
  }
  return best
}

function findBestPersonRowForScanner(
  scanner: string,
  personRows: AttendanceEfficiencyResult['personRows'] | undefined,
) {
  if (!personRows?.length) return null
  let best: (typeof personRows)[number] | null = null
  let bestScore = -1
  for (const person of personRows) {
    for (const label of collectPersonMatchLabels({
      sorterName: person.sorterName,
      sorterKey: person.sorterKey,
      efficiencyMatchNames: person.efficiencyMatchNames,
    })) {
      const score = scoreScannerNicknameMatch(scanner, label)
      if (score > bestScore) {
        bestScore = score
        best = person
      }
    }
  }
  return best
}

export const sortingEfficiencyForPerson = (
  personRow: PersonRowForSorting,
  scannerResult: ScannerEfficiencyResult | null,
): number | '' => {
  const rows = scannerResult?.scannerTotalRows
  if (!rows?.length) return ''
  const match = findBestScannerRowForPerson(personRow, rows)
  if (!match) return ''
  return Number(match.adjustedEfficiency.toFixed(2))
}

export const sortingScanCountForPerson = (
  personRow: PersonRowForSorting,
  scannerResult: ScannerEfficiencyResult | null,
): number | '' => {
  const rows = scannerResult?.scannerTotalRows
  if (!rows?.length) return ''
  const match = findBestScannerRowForPerson(personRow, rows)
  return match ? match.scanCount : ''
}

export const sortingAverageEfficiencyValue = (scannerResult: ScannerEfficiencyResult | null): number | '' => {
  const v = scannerResult?.summary?.totalEfficiency
  if (typeof v !== 'number' || !Number.isFinite(v)) return ''
  return Number(v.toFixed(2))
}

export type ScannerTotalEfficiencyRow = {
  scanner: string
  scanCount: number
  totalHours: number | null
  totalEfficiency: number | null
}

/** 分拣员总效率：个人扫描量 ÷ 考勤总工时（统计窗口内汇总） */
export function buildScannerTotalEfficiencyRows(
  scannerResult: ScannerEfficiencyResult | null,
  personRows: AttendanceEfficiencyResult['personRows'] | undefined,
): ScannerTotalEfficiencyRow[] {
  if (!scannerResult?.scannerTotalRows?.length) return []
  return scannerResult.scannerTotalRows
    .map((row) => {
      const person = findBestPersonRowForScanner(row.scanner, personRows)
      const totalHours = person?.totalHours ?? null
      const totalEfficiency =
        totalHours != null && totalHours > 0 ? row.scanCount / totalHours : null
      return {
        scanner: row.scanner,
        scanCount: row.scanCount,
        totalHours,
        totalEfficiency,
      }
    })
    .sort((a, b) => {
      const ae = a.totalEfficiency ?? -1
      const be = b.totalEfficiency ?? -1
      if (be !== ae) return be - ae
      return b.scanCount - a.scanCount
    })
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
