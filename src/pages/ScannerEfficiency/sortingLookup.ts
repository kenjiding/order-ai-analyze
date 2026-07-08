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
  cainiaoShare: number | null
  cainiaoCorrectionFactor: number | null
  totalHours: number | null
  totalEfficiency: number | null
  cainiaoAdjustedTotalEfficiency: number | null
}

/** 分拣员总效率：个人扫描量 ÷ 考勤总工时（统计窗口内汇总），并应用菜鸟难度修正因子 */
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
      const cainiaoAdjustedTotalEfficiency =
        totalEfficiency != null ? totalEfficiency * row.cainiaoCorrectionFactor : null
      return {
        scanner: row.scanner,
        scanCount: row.scanCount,
        cainiaoShare: row.cainiaoShare,
        cainiaoCorrectionFactor: row.cainiaoCorrectionFactor,
        totalHours,
        totalEfficiency,
        cainiaoAdjustedTotalEfficiency,
      }
    })
    .sort((a, b) => {
      const ae = a.cainiaoAdjustedTotalEfficiency ?? -1
      const be = b.cainiaoAdjustedTotalEfficiency ?? -1
      if (be !== ae) return be - ae
      return b.scanCount - a.scanCount
    })
}

export type TopPerformerCandidate = {
  scanner: string
  scanCount: number
  activeDays: number
  cainiaoShare: number
  cainiaoAdjustedEfficiency: number
  cainiaoAdjustedTotalEfficiency: number | null
  attendanceTotalHours: number | null
  compositeScore: number
}

/**
 * 按综合评分选出 Top N 分拣员（代码计算，结果稳定可复现）。
 *
 * 评分维度与权重：
 *   有总效率数据：出勤天数 20% + 修正效率 40% + 总效率 40%
 *   无总效率数据：出勤天数 33% + 修正效率 67%（保持维度间相对权重）
 *
 * 各维度均做 min-max 归一化后再加权，排除扫描量 < MIN_SCAN_COUNT 的低样本员工。
 */
export function selectTopPerformers(
  scannerTotalRows: ScannerEfficiencyResult['scannerTotalRows'],
  scannerTotalEfficiencyRows: ScannerTotalEfficiencyRow[],
  topN = 5,
): TopPerformerCandidate[] {
  const MIN_SCAN_COUNT = 300

  const totalEffMap = new Map(scannerTotalEfficiencyRows.map((r) => [r.scanner, r]))

  const candidates = scannerTotalRows
    .filter((r) => r.scanCount >= MIN_SCAN_COUNT)
    .map((r) => {
      const att = totalEffMap.get(r.scanner)
      return {
        scanner: r.scanner,
        scanCount: r.scanCount,
        activeDays: r.activeDays,
        cainiaoShare: r.cainiaoShare ?? 0,
        cainiaoAdjustedEfficiency: r.cainiaoAdjustedEfficiency ?? r.adjustedEfficiency,
        cainiaoAdjustedTotalEfficiency: att?.cainiaoAdjustedTotalEfficiency ?? null,
        attendanceTotalHours: att?.totalHours ?? null,
      }
    })

  if (!candidates.length) return []

  // min-max 归一化
  const lo = (arr: number[]) => Math.min(...arr)
  const hi = (arr: number[]) => Math.max(...arr)
  const norm = (v: number, min: number, max: number) => (max > min ? (v - min) / (max - min) : 0)

  const daysVals = candidates.map((c) => c.activeDays)
  const adjEffVals = candidates.map((c) => c.cainiaoAdjustedEfficiency)
  const daysMin = lo(daysVals), daysMax = hi(daysVals)
  const adjEffMin = lo(adjEffVals), adjEffMax = hi(adjEffVals)

  // 仅对有总效率的候选人归一化总效率维度
  const withTotal = candidates.filter((c) => c.cainiaoAdjustedTotalEfficiency != null)
  const totalEffMin = withTotal.length ? lo(withTotal.map((c) => c.cainiaoAdjustedTotalEfficiency!)) : 0
  const totalEffMax = withTotal.length ? hi(withTotal.map((c) => c.cainiaoAdjustedTotalEfficiency!)) : 0

  const scored: TopPerformerCandidate[] = candidates.map((c) => {
    const sDays = norm(c.activeDays, daysMin, daysMax)
    const sAdjEff = norm(c.cainiaoAdjustedEfficiency, adjEffMin, adjEffMax)
    let compositeScore: number
    if (c.cainiaoAdjustedTotalEfficiency != null) {
      const sTotalEff = norm(c.cainiaoAdjustedTotalEfficiency, totalEffMin, totalEffMax)
      compositeScore = 0.20 * sDays + 0.40 * sAdjEff + 0.40 * sTotalEff
    } else {
      compositeScore = 0.33 * sDays + 0.67 * sAdjEff
    }
    return { ...c, compositeScore }
  })

  return scored.sort((a, b) => b.compositeScore - a.compositeScore).slice(0, topN)
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
