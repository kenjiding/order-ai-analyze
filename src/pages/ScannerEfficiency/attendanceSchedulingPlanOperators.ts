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

export const OPERATOR_REMARK_FORKLIFT = '负责装货, 卸货，整理货物，记录货物，整理托盘等'
export const OPERATOR_REMARK_SORTING =
  '粗分 和 细分，整理仓库物品，笼车整理，割纸皮， 整理纸皮和托盘，清理垃圾'
export const OPERATOR_REMARK_FRONT_DESK = '归班，盘点，分配包裹，上下架包裹，退返商家'
export const OPERATOR_NOTE_SORTING = '叉车工作完成后会加入到粗分+细分+仓内整理里一起工作'
export const OPERATOR_NOTE_FRONT_DESK = '前台完成上午工作后会加入细分环节'
export const OPERATOR_NOTE_CLEANING = '清洁仓库是分拣完成后从中挑选2人做清洁工作'

const REMARK_FORKLIFT = OPERATOR_REMARK_FORKLIFT
const REMARK_SORTING = OPERATOR_REMARK_SORTING
const REMARK_FRONT_DESK = OPERATOR_REMARK_FRONT_DESK
const NOTE_SORTING = OPERATOR_NOTE_SORTING
const NOTE_CLEANING = OPERATOR_NOTE_CLEANING

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

const CLOCK_TIME_PARSE_FORMATS = ['H:mm', 'HH:mm', 'H:mm:ss', 'HH:mm:ss'] as const

function parseClockTimeText(text: string): dayjs.Dayjs | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  for (const format of CLOCK_TIME_PARSE_FORMATS) {
    const parsed = dayjs(trimmed, format, true)
    if (parsed.isValid()) return parsed
  }
  return null
}

/** 由计划上下班时间推算单人预计出勤工时（小时，保留 1 位小数） */
export function computeExpectedHoursFromClockTimes(plannedStart: string, plannedEnd: string): string {
  const start = parseClockTimeText(plannedStart)
  const end = parseClockTimeText(plannedEnd)
  if (!start || !end) return ''

  const baseDate = '2000-01-01'
  let startAt = dayjs(`${baseDate} ${start.format('HH:mm:ss')}`, 'YYYY-MM-DD HH:mm:ss')
  let endAt = dayjs(`${baseDate} ${end.format('HH:mm:ss')}`, 'YYYY-MM-DD HH:mm:ss')
  if (!startAt.isValid() || !endAt.isValid()) return ''
  if (!endAt.isAfter(startAt)) {
    endAt = endAt.add(1, 'day')
  }

  const hours = endAt.diff(startAt, 'minute') / 60
  const formatted = formatHours(hours)
  return formatted === '' ? '' : String(formatted)
}

function parseAttendanceCount(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const count = Number(trimmed)
  if (!Number.isFinite(count) || count <= 0) return null
  return count
}

/** 预计出勤工时 = 单人时长 × 出勤人数（总工时，保留 1 位小数） */
export function computeOperatorExpectedHours(
  attendanceCount: string,
  plannedStart: string,
  plannedEnd: string,
): string {
  const perPersonHours = computeExpectedHoursFromClockTimes(plannedStart, plannedEnd)
  if (!perPersonHours) return ''
  const count = parseAttendanceCount(attendanceCount)
  if (count == null) return ''
  const formatted = formatHours(Number(perPersonHours) * count)
  return formatted === '' ? '' : String(formatted)
}

const OPERATOR_HOURS_INPUT_KEY = /^(.+:op-\d+)-(start|end|count)$/

function resolveOperatorRowHours(prev: Record<string, string>, rowPrefix: string): string {
  return computeOperatorExpectedHours(
    prev[`${rowPrefix}-count`] ?? '',
    prev[`${rowPrefix}-start`] ?? '',
    prev[`${rowPrefix}-end`] ?? '',
  )
}

/** 编辑出勤人数或计划上下班时间后，同步更新同一行的预计出勤工时（总工时） */
export function applyOperatorExpectedHoursFromClockTimes(
  prev: Record<string, string>,
  key: string,
  text: string,
): Record<string, string> {
  const match = key.match(OPERATOR_HOURS_INPUT_KEY)
  if (!match) {
    return { ...prev, [key]: text }
  }

  const rowPrefix = match[1]!
  const next = { ...prev, [key]: text }

  return {
    ...next,
    [`${rowPrefix}-hours`]: resolveOperatorRowHours(next, rowPrefix),
  }
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
    rowFromAttendance('叉车', 1, forklift, forklift?.hours ?? null, REMARK_FORKLIFT, NOTE_SORTING),
    rowFromAttendance(
      '粗分 + 细分+仓内整理',
      level1SorterCount,
      medianLevel28,
      level28TotalHours > 0 ? level28TotalHours : null,
      REMARK_SORTING,
    ),
    rowFromAttendance('前台', 1, frontDesk, frontDesk?.hours ?? null, REMARK_FRONT_DESK, OPERATOR_NOTE_FRONT_DESK),
    rowFromAttendance('清洁仓库', 2, null, 0.5, '清洁仓库', NOTE_CLEANING),
  ]
}

/** 飞书排班推送手动模板：岗位结构 + 固定备注，数值由人工填写 */
export function buildDefaultOperatorAttendancePlanRows(): OperatorAttendancePlanRow[] {
  return [
    {
      position: '叉车',
      count: 0,
      plannedStart: '',
      plannedEnd: '',
      expectedHours: '',
      remark: OPERATOR_REMARK_FORKLIFT,
      note: OPERATOR_NOTE_SORTING,
    },
    {
      position: '粗分 + 细分+仓内整理',
      count: 0,
      plannedStart: '',
      plannedEnd: '',
      expectedHours: '',
      remark: OPERATOR_REMARK_SORTING,
      note: '',
    },
    {
      position: '前台',
      count: 0,
      plannedStart: '',
      plannedEnd: '',
      expectedHours: '',
      remark: OPERATOR_REMARK_FRONT_DESK,
      note: OPERATOR_NOTE_FRONT_DESK,
    },
    {
      position: '清洁仓库',
      count: 0,
      plannedStart: '',
      plannedEnd: '',
      expectedHours: '',
      remark: '清洁仓库',
      note: OPERATOR_NOTE_CLEANING,
    },
  ]
}
