import type { DataTableRow } from './components/ui'
import type { ScannerSummaryChartRow } from './ScannerSummaryBarChart'
import type { ScannerTotalEfficiencyRow } from './sortingLookup'

function avg(nums: number[]): number | null {
  if (!nums.length) return null
  return nums.reduce((sum, n) => sum + n, 0) / nums.length
}

export function buildScannerPersonSummaryAverageRow(
  rows: ScannerSummaryChartRow[],
): DataTableRow | null {
  if (!rows.length) return null
  return {
    isTableAverageRow: true,
    scanner: '平均',
    scanCount: avg(rows.map((r) => r.scanCount)),
    activeDays: avg(rows.map((r) => r.activeDays)),
    effectiveHours: avg(rows.map((r) => r.effectiveHours)),
    adjustedEfficiency: avg(rows.map((r) => r.adjustedEfficiency)),
  }
}

export function buildScannerTotalEfficiencyAverageRow(
  rows: ScannerTotalEfficiencyRow[],
): DataTableRow | null {
  if (!rows.length) return null
  const matchedHours = rows.filter((r) => r.totalHours != null).map((r) => r.totalHours!)
  const matchedEff = rows.filter((r) => r.totalEfficiency != null).map((r) => r.totalEfficiency!)
  return {
    isTableAverageRow: true,
    scanner: '平均',
    scanCount: avg(rows.map((r) => r.scanCount)),
    totalHours: avg(matchedHours),
    totalEfficiency: avg(matchedEff),
  }
}
