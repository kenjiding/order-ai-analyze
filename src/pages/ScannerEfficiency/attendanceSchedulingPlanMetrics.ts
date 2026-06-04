import type { AttendanceEfficiencyResult, ScannerEfficiencyResult } from './aggregates'

export function resolveLevel1SorterCountForDate(
  scannerResult: ScannerEfficiencyResult | null,
  attendanceResult: AttendanceEfficiencyResult,
  planDate: string,
): number {
  const dailySummary = scannerResult?.dailySummaryRows.find((row) => row.date === planDate)
  if (dailySummary && dailySummary.scannerCount > 0) {
    return dailySummary.scannerCount
  }
  const dayRow = attendanceResult.dailyRows.find((row) => row.date === planDate)
  return dayRow?.sorterCount ?? 0
}

export function resolveLevel1SorterCount(
  scannerResult: ScannerEfficiencyResult | null,
  attendanceResult: AttendanceEfficiencyResult,
): number {
  if (scannerResult?.summary.totalScanners) {
    return scannerResult.summary.totalScanners
  }
  const counts = attendanceResult.dailyRows
    .filter((r) => r.hasAttendance && !r.isAttendanceOnly)
    .map((r) => r.sorterCount)
  return counts.length ? Math.max(...counts) : 0
}
