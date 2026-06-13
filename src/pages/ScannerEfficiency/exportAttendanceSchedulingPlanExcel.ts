import type { AttendanceEfficiencyResult, ScannerEfficiencyResult } from './aggregates'
import type { DailyLaborCostMetrics } from '../../payroll/laborCostFromAttendance'
import { resolveLevel1SorterCountForDate } from './attendanceSchedulingPlanMetrics'
import { resolveCoarseStageHours } from './coarseStageHours'
import { sortingEfficiencyForDate } from './sortingLookup'

/** 粗分目标效率（件/小时） */
export const COARSE_SORT_TARGET_EFFICIENCY = 470

/** 总体人效目标效率（件/小时） */
export const OVERALL_TARGET_EFFICIENCY = 140

/** 总体情况「预计总工时/h」说明列文案 */
export const OVERALL_TOTAL_HOURS_NOTE =
  '总工时： 「叉车 + 前台 + 粗分 + 细分 + 割纸皮 + 清洁仓库」 各个岗位工时的总和'

/** 总体情况「每票成本」说明列文案 */
export const OVERALL_COST_PER_TICKET_NOTE = '每票成本最能看出成本和效率的直接关系'

/** 主表区域列宽（标题、总体情况、效率达成等），第 3 列略宽以容纳「实际计划效率（件/小时）」 */
export const BASE_SHEET_COLUMN_WIDTHS = [14, 16, 19, 16, 14, 16, 14] as const

/** 仅「作业人员出勤说明」向右扩展的附加列宽 */
export const ATTENDANCE_EXTRA_COLUMN_WIDTHS = [24, 24, 22] as const

function formatPlanDateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (!m) return isoDate
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`
}

/** 出勤排班「总体情况-总成本」展示（如 $1234.56） */
export function formatTotalLaborCostDisplay(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return `$${Number(value.toFixed(2))}`
}

/** 出勤排班「总体情况-每票成本」展示（如 1.23/票） */
export function formatCostPerTicketDisplay(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return `${Number(value.toFixed(2))}/票`
}

export type AttendanceSchedulingPlanSnapshot = {
  sheetTitle: string
  totalVolume: number
  totalHours: number
  coarseStageHours: number | null
  level1SorterCount: number
  avgSortingEfficiency: number | ''
  coarseAchievementRatio: number | null
  overallEfficiency: number | null
  overallAchievementRatio: number | null
  overallCainiaoShare: number | null
  directStaffRatio: number | null
  operatorHeadcount: number
  totalLaborCost: number | null
  costPerTicket: number | null
}

export function resolveOpenPlanDates(attendanceResult: AttendanceEfficiencyResult): string[] {
  return attendanceResult.dailyRows
    .filter((row) => row.isOpenDay)
    .map((row) => row.date)
    .sort((a, b) => a.localeCompare(b))
}

export function buildAttendanceSchedulingPlanSnapshot({
  attendanceResult,
  scannerResult,
  planDate,
  warehouseTitle = '阿德莱德仓库',
  dailyLaborCostByDate,
}: {
  attendanceResult: AttendanceEfficiencyResult
  scannerResult: ScannerEfficiencyResult | null
  planDate: string
  warehouseTitle?: string
  dailyLaborCostByDate?: Record<string, DailyLaborCostMetrics>
}): AttendanceSchedulingPlanSnapshot {
  const dayRow = attendanceResult.dailyRows.find((row) => row.date === planDate)
  if (!dayRow) {
    throw new Error(`Missing attendance day row for plan date: ${planDate}`)
  }

  const totalVolume = dayRow.volume
  const totalHours = dayRow.totalHours
  const level1SorterCount = resolveLevel1SorterCountForDate(scannerResult, attendanceResult, planDate)
  const avgSortingEfficiency = sortingEfficiencyForDate(scannerResult, planDate)
  const coarseAchievementRatio =
    typeof avgSortingEfficiency === 'number' && avgSortingEfficiency > 0
      ? avgSortingEfficiency / COARSE_SORT_TARGET_EFFICIENCY
      : null
  const overallEfficiency = dayRow.dayEfficiency
  const overallAchievementRatio =
    overallEfficiency != null && Number.isFinite(overallEfficiency) && overallEfficiency > 0
      ? overallEfficiency / OVERALL_TARGET_EFFICIENCY
      : null
  const operatorHeadcount = 2 + level1SorterCount
  const directStaffRatio =
    operatorHeadcount > 0 ? level1SorterCount / operatorHeadcount : null

  const overallCainiaoShare = dayRow.volume > 0 ? dayRow.cainiaoShare : null
  const coarseStageHours = resolveCoarseStageHours(scannerResult, planDate)
  const laborMetrics = dailyLaborCostByDate?.[planDate]
  const totalLaborCost = laborMetrics?.totalLaborCost ?? null
  const costPerTicket = laborMetrics?.costPerTicket ?? null
  const planDateLabel = formatPlanDateLabel(planDate)
  const sheetTitle = `${warehouseTitle} 出勤及排班计划 (${planDateLabel})`

  return {
    sheetTitle,
    totalVolume,
    totalHours,
    coarseStageHours,
    level1SorterCount,
    avgSortingEfficiency,
    coarseAchievementRatio,
    overallEfficiency,
    overallAchievementRatio,
    overallCainiaoShare,
    directStaffRatio,
    operatorHeadcount,
    totalLaborCost,
    costPerTicket,
  }
}
