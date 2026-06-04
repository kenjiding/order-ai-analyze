import type { ScannerEfficiencyResult } from './aggregates'

/** 粗分环节工时：同人扫描间隔超过 1 小时则分段，避免漏扫/二轮分拣把首末差拉长。 */
export const COARSE_STAGE_SPAN_SPLIT_THRESHOLD_MINUTES = 60

/** 统计日各有效扫描员作业跨度之和（小时），用于出勤排班导出「粗分环节工时」。 */
export function resolveCoarseStageHours(
  scannerResult: ScannerEfficiencyResult | null,
  referenceDate: string,
): number | null {
  if (!scannerResult?.dailyScannerRows.length) return null

  const dayRows = scannerResult.dailyScannerRows.filter((row) => row.date === referenceDate)
  if (!dayRows.length) return null

  const totalMinutes = dayRows.reduce((sum, row) => sum + row.spanMinutes, 0)
  if (totalMinutes <= 0) return null
  return totalMinutes / 60
}
