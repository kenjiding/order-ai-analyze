import type { AttendanceEfficiencyResult, ParsedAttendanceRow, ScannerEfficiencyResult } from './aggregates'
import { isPositionLevel } from './attendancePositionLevel'
import { resolveLevel1SorterCountForDate } from './attendanceSchedulingPlanMetrics'
import { dayjs } from './dayjsSetup'

export type OperatorAttendancePlanRow = {
  position: string
  count: number
  plannedStart: string
  plannedEnd: string
  expectedHours: number | string
  remark: string
  note: string
}

const REMARK_FORKLIFT = '负责装货, 卸货，整理货物，记录货物，整理托盘等'
const REMARK_SORTING =
  '粗分 和 细分，整理仓库物品，笼车整理，割纸皮， 整理纸皮和托盘，清理垃圾'
const REMARK_FRONT_DESK = '归班，盘点，分配包裹，上下架包裹，退返商家'
const NOTE_SORTING = '叉车工作完成后会加入到粗分+细分+仓内整理里一起工作'
const NOTE_CLEANING = '清洁仓库是分拣完成后从中挑选2人做清洁工作'

function formatClockTime(value: Date | null | undefined): string {
  if (!value) return ''
  const d = dayjs(value)
  if (!d.isValid()) return ''
  return d.format('H:mm')
}

function formatHours(value: number | null | undefined): number | string {
  if (value == null || !Number.isFinite(value) || value <= 0) return ''
  return Number(value.toFixed(1))
}

function medianAttendanceRow(rows: ParsedAttendanceRow[]): ParsedAttendanceRow | null {
  if (!rows.length) return null
  const sorted = [...rows].sort((a, b) => a.hours - b.hours)
  return sorted[Math.floor(sorted.length / 2)]!
}

function resolveLevel30ForkliftAndFrontDesk(
  rows: ParsedAttendanceRow[],
): { forklift: ParsedAttendanceRow | null; frontDesk: ParsedAttendanceRow | null } {
  const level30 = rows.filter((row) => isPositionLevel(row, 30))
  if (level30.length === 0) return { forklift: null, frontDesk: null }
  if (level30.length === 1) return { forklift: null, frontDesk: level30[0]! }
  const sorted = [...level30].sort((a, b) => a.hours - b.hours)
  return { forklift: sorted[0]!, frontDesk: sorted[sorted.length - 1]! }
}

function rowFromAttendance(
  position: string,
  count: number,
  source: ParsedAttendanceRow | null,
  totalHours: number | null,
  remark: string,
  note = '',
): OperatorAttendancePlanRow {
  return {
    position,
    count,
    plannedStart: formatClockTime(source?.clockInTime),
    plannedEnd: formatClockTime(source?.clockOutTime),
    expectedHours: formatHours(totalHours ?? source?.hours),
    remark,
    note,
  }
}

export function resolveOperatorAttendancePlanRows({
  attendanceRows,
  attendanceResult,
  scannerResult,
  planDate,
}: {
  attendanceRows: ParsedAttendanceRow[]
  attendanceResult: AttendanceEfficiencyResult
  scannerResult: ScannerEfficiencyResult | null
  planDate: string
}): OperatorAttendancePlanRow[] {
  const dayRows = attendanceRows.filter((row) => row.date === planDate)
  const level1SorterCount = resolveLevel1SorterCountForDate(scannerResult, attendanceResult, planDate)

  const { forklift, frontDesk } = resolveLevel30ForkliftAndFrontDesk(dayRows)
  const level28Rows = dayRows.filter((row) => isPositionLevel(row, 28))
  const sortingRows =
    level28Rows.length > 0 ? level28Rows : dayRows.filter((row) => row.isSorterWorker && !isPositionLevel(row, 30))
  const medianLevel28 = medianAttendanceRow(sortingRows)
  const level28TotalHours = sortingRows.reduce((sum, row) => sum + row.hours, 0)

  return [
    rowFromAttendance('叉车', 1, forklift, forklift?.hours ?? null, REMARK_FORKLIFT),
    rowFromAttendance(
      '粗分 + 细分+仓内整理',
      level1SorterCount,
      medianLevel28,
      level28TotalHours > 0 ? level28TotalHours : null,
      REMARK_SORTING,
      NOTE_SORTING,
    ),
    rowFromAttendance('前台', 1, frontDesk, frontDesk?.hours ?? null, REMARK_FRONT_DESK),
    rowFromAttendance('清洁仓库', 2, null, 0.5, '清洁仓库', NOTE_CLEANING),
  ]
}
