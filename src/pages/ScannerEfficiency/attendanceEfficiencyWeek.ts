import type { DailyEfficiencyBubbleDatum } from './DailyEfficiencyBubbleChart'
import {
  computeAttendanceDailyMatchAverages,
  type AttendanceDailyMatchRow,
} from './aggregates'
import type { DataTableRow } from './components/ui'
import { dayjs } from './dayjsSetup'

export const EFFICIENCY_WEEK_COLORS = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#65a30d',
  '#ea580c',
] as const

export type EfficiencyWeekBounds = {
  weekKey: string
  weekStart: string
  weekEnd: string
  weekLabel: string
  weekIndex: number
  weekColor: string
}

export type DailyEfficiencyBubbleDatumWithWeek = DailyEfficiencyBubbleDatum & EfficiencyWeekBounds

export type WeeklyEfficiencyBubbleDatum = {
  weekKey: string
  weekStart: string
  weekEnd: string
  weekLabel: string
  weekIndex: number
  weekColor: string
  /** 用于在 band 轴上定位周汇总点：取该周内有数据日期的中间日 */
  anchorDate: string
  dayCount: number
  sorterCount: number
  volume: number
  cainiaoVolume: number
  cainiaoShare: number | null
  totalHours: number
  efficiency: number | null
  costPerTicket: number | null
  totalLaborCost: number | null
}

const weekColorByIndex = (index: number): string =>
  EFFICIENCY_WEEK_COLORS[index % EFFICIENCY_WEEK_COLORS.length]

export function resolveEfficiencyWeekBounds(date: string, weekIndex: number): EfficiencyWeekBounds {
  const d = dayjs(date)
  const weekStart = d.startOf('isoWeek').format('YYYY-MM-DD')
  const weekEnd = d.endOf('isoWeek').format('YYYY-MM-DD')
  return {
    weekKey: weekStart,
    weekStart,
    weekEnd,
    weekLabel: `${weekStart} ~ ${weekEnd}`,
    weekIndex,
    weekColor: weekColorByIndex(weekIndex),
  }
}

function assignWeekIndices(dates: string[]): Map<string, number> {
  const sortedKeys = [...new Set(dates.map((date) => dayjs(date).startOf('isoWeek').format('YYYY-MM-DD')))].sort(
    (a, b) => a.localeCompare(b),
  )
  return new Map(sortedKeys.map((key, index) => [key, index]))
}

export function enrichDailyEfficiencyBubbleDataWithWeek(
  data: DailyEfficiencyBubbleDatum[],
): DailyEfficiencyBubbleDatumWithWeek[] {
  if (!data.length) return []
  const weekIndexMap = assignWeekIndices(data.map((row) => row.date))
  return data.map((row) => {
    const weekKey = dayjs(row.date).startOf('isoWeek').format('YYYY-MM-DD')
    const weekIndex = weekIndexMap.get(weekKey) ?? 0
    return {
      ...row,
      ...resolveEfficiencyWeekBounds(row.date, weekIndex),
    }
  })
}

export function buildWeeklyEfficiencyBubbleData(
  dailyWithWeek: DailyEfficiencyBubbleDatumWithWeek[],
): WeeklyEfficiencyBubbleDatum[] {
  if (!dailyWithWeek.length) return []

  const groups = new Map<string, DailyEfficiencyBubbleDatumWithWeek[]>()
  for (const row of dailyWithWeek) {
    const bucket = groups.get(row.weekKey) ?? []
    bucket.push(row)
    groups.set(row.weekKey, bucket)
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, rows]) => {
      const meta = rows[0]
      const sortedDates = rows.map((r) => r.date).sort((a, b) => a.localeCompare(b))
      const anchorDate = sortedDates[Math.floor((sortedDates.length - 1) / 2)]
      const volume = rows.reduce((sum, r) => sum + r.volume, 0)
      const cainiaoVolume = rows.reduce((sum, r) => sum + r.cainiaoVolume, 0)
      const totalHours = rows.reduce((sum, r) => sum + r.totalHours, 0)
      const laborValues = rows
        .map((r) => r.totalLaborCost)
        .filter((v): v is number => v != null && Number.isFinite(v))
      const totalLaborCost = laborValues.length
        ? laborValues.reduce((a, b) => a + b, 0)
        : null
      const costPerTicket =
        totalLaborCost != null && volume > 0 ? totalLaborCost / volume : null
      const maxSorter = rows.reduce((max, r) => Math.max(max, r.sorterCount), 0)

      return {
        weekKey,
        weekStart: meta.weekStart,
        weekEnd: meta.weekEnd,
        weekLabel: meta.weekLabel,
        weekIndex: meta.weekIndex,
        weekColor: meta.weekColor,
        anchorDate,
        dayCount: rows.length,
        sorterCount: maxSorter,
        volume,
        cainiaoVolume,
        cainiaoShare: volume > 0 ? cainiaoVolume / volume : null,
        totalHours,
        efficiency: totalHours > 0 ? volume / totalHours : null,
        costPerTicket,
        totalLaborCost,
      }
    })
}

/** 周汇总：总货量、总体效率（总货量 ÷ 全部考勤工时，与页头口径一致） */
export function computeWeeklySummaryByWeekKey(
  dailyRows: AttendanceDailyMatchRow[],
): Map<string, { totalVolume: number; overallEfficiency: number | null }> {
  const groups = new Map<string, AttendanceDailyMatchRow[]>()
  for (const row of dailyRows) {
    const weekKey = dayjs(row.date).startOf('isoWeek').format('YYYY-MM-DD')
    const bucket = groups.get(weekKey) ?? []
    bucket.push(row)
    groups.set(weekKey, bucket)
  }

  const out = new Map<string, { totalVolume: number; overallEfficiency: number | null }>()
  for (const [weekKey, rows] of groups) {
    const totalVolume = rows.reduce((sum, r) => sum + r.volume, 0)
    const allHours = rows.reduce((sum, r) => sum + r.totalHours, 0)
    out.set(weekKey, {
      totalVolume,
      overallEfficiency: allHours > 0 ? totalVolume / allHours : null,
    })
  }
  return out
}

type BuildWeeklyTableParams = {
  dailyRows: AttendanceDailyMatchRow[]
  dailyCostPerTicketByDate?: Record<string, number | null>
  dailyTotalLaborCostByDate?: Record<string, number | null>
  attendancePayrollTotal: number | null
  attendancePayroll: { wagesByDate: Record<string, number> } | null
}

function mapDailyRowToTableRow(
  r: AttendanceDailyMatchRow,
  dailyCostPerTicketByDate?: Record<string, number | null>,
  dailyTotalLaborCostByDate?: Record<string, number | null>,
): DataTableRow {
  return {
    ...(r as unknown as DataTableRow),
    attendanceCostPerTicket: dailyCostPerTicketByDate?.[r.date] ?? null,
    attendanceTotalLaborCost: dailyTotalLaborCostByDate?.[r.date] ?? null,
  }
}

function groupDailyRowsByWeek(dailyRows: AttendanceDailyMatchRow[]) {
  const weekIndexMap = assignWeekIndices(dailyRows.map((row) => row.date))
  const groups = new Map<string, AttendanceDailyMatchRow[]>()
  for (const row of dailyRows) {
    const weekKey = dayjs(row.date).startOf('isoWeek').format('YYYY-MM-DD')
    const bucket = groups.get(weekKey) ?? []
    bucket.push(row)
    groups.set(weekKey, bucket)
  }
  return { weekIndexMap, groups, sortedWeekKeys: [...groups.keys()].sort((a, b) => a.localeCompare(b)) }
}

function buildWeekSummaryFooterRow(
  weekRows: AttendanceDailyMatchRow[],
  bounds: EfficiencyWeekBounds,
  weekIndex: number,
  dailyCostPerTicketByDate?: Record<string, number | null>,
  dailyTotalLaborCostByDate?: Record<string, number | null>,
  options?: { label?: string },
): DataTableRow {
  const weekAvgs = computeAttendanceDailyMatchAverages(weekRows)
  const weekBodyRows = weekRows.map((r) =>
    mapDailyRowToTableRow(r, dailyCostPerTicketByDate, dailyTotalLaborCostByDate),
  )
  const weekVolumeForUnitCost = weekBodyRows.reduce(
    (sum, r) => sum + (Number(r.volume) > 0 ? Number(r.volume) : 0),
    0,
  )
  const weekLaborSum = weekBodyRows.reduce((sum, r) => {
    const labor = r.attendanceTotalLaborCost
    return sum + (labor != null && Number.isFinite(Number(labor)) ? Number(labor) : 0)
  }, 0)
  const weekCostPerTicketFromTotals =
    weekLaborSum > 0 && weekVolumeForUnitCost > 0 ? weekLaborSum / weekVolumeForUnitCost : null

  return {
    date: options?.label ?? `第 ${weekIndex + 1} 周 · ${bounds.weekLabel}`,
    isWeekGroupFooter: true,
    weekKey: bounds.weekKey,
    weekColor: bounds.weekColor,
    isAttendanceOnly: false,
    sorterCount: 0,
    isOpenDay: false,
    hasAttendance: true,
    matchFooterStats: {
      ...weekAvgs,
      avgCostPerTicket: weekCostPerTicketFromTotals,
      costPerTicketFromTotals: weekCostPerTicketFromTotals,
      totalLaborCostSum: weekLaborSum > 0 ? weekLaborSum : null,
      avgTotalLaborCost:
        weekLaborSum > 0 && weekRows.length > 0 ? weekLaborSum / weekRows.length : null,
    },
  } as DataTableRow
}

function buildAttendanceWindowFooterRow({
  dailyRows,
  dailyCostPerTicketByDate,
  dailyTotalLaborCostByDate,
  attendancePayrollTotal,
  attendancePayroll,
}: BuildWeeklyTableParams): DataTableRow {
  const bodyRows = dailyRows.map((r) =>
    mapDailyRowToTableRow(r, dailyCostPerTicketByDate, dailyTotalLaborCostByDate),
  )
  const avgs = computeAttendanceDailyMatchAverages(dailyRows)
  const totalLaborCostSum = attendancePayrollTotal
  const payrollDaysWithCost = attendancePayroll
    ? Object.values(attendancePayroll.wagesByDate).filter((v) => v > 0).length
    : 0
  const avgTotalLaborCost =
    totalLaborCostSum != null && payrollDaysWithCost > 0
      ? totalLaborCostSum / payrollDaysWithCost
      : null
  const totalVolumeForUnitCost = bodyRows.reduce(
    (sum, r) => sum + (Number(r.volume) > 0 ? Number(r.volume) : 0),
    0,
  )
  const costPerTicketFromTotals =
    totalLaborCostSum != null && totalVolumeForUnitCost > 0
      ? totalLaborCostSum / totalVolumeForUnitCost
      : null

  return {
    date: '总计',
    isAttendanceMatchFooter: true,
    isAttendanceOnly: false,
    sorterCount: 0,
    isOpenDay: false,
    hasAttendance: true,
    matchFooterStats: {
      ...avgs,
      avgCostPerTicket: costPerTicketFromTotals,
      costPerTicketFromTotals,
      totalLaborCostSum,
      avgTotalLaborCost,
    },
  } as DataTableRow
}

/** 周维度：每行一周汇总，便于多周横向对比；日明细请切回「日维度」。 */
export function buildAttendanceWeeklySummaryTableRows(params: BuildWeeklyTableParams): DataTableRow[] {
  const { dailyRows } = params
  if (!dailyRows.length) return []

  const { weekIndexMap, groups, sortedWeekKeys } = groupDailyRowsByWeek(dailyRows)
  const out: DataTableRow[] = []

  sortedWeekKeys.forEach((weekKey, weekIndex) => {
    const weekRows = [...(groups.get(weekKey) ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    const bounds = resolveEfficiencyWeekBounds(weekRows[0].date, weekIndexMap.get(weekKey) ?? weekIndex)
    const summaryRow = buildWeekSummaryFooterRow(
      weekRows,
      bounds,
      weekIndex,
      params.dailyCostPerTicketByDate,
      params.dailyTotalLaborCostByDate,
    )
    out.push({
      ...summaryRow,
      isWeekSummaryRow: true,
      weekDailyRows: weekRows.map((r) =>
        mapDailyRowToTableRow(r, params.dailyCostPerTicketByDate, params.dailyTotalLaborCostByDate),
      ),
    })
  })

  out.push(buildAttendanceWindowFooterRow(params))
  return out
}

export function buildAttendanceWeeklyGroupedTableRows(params: BuildWeeklyTableParams): DataTableRow[] {
  const { dailyRows, dailyCostPerTicketByDate, dailyTotalLaborCostByDate } = params
  if (!dailyRows.length) return []

  const { weekIndexMap, groups, sortedWeekKeys } = groupDailyRowsByWeek(dailyRows)
  const out: DataTableRow[] = []

  sortedWeekKeys.forEach((weekKey, weekIndex) => {
    const weekRows = [...(groups.get(weekKey) ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    const bounds = resolveEfficiencyWeekBounds(weekRows[0].date, weekIndexMap.get(weekKey) ?? weekIndex)

    out.push({
      isWeekGroupHeader: true,
      date: `第 ${weekIndex + 1} 周 · ${bounds.weekLabel}`,
      weekLabel: bounds.weekLabel,
      weekColor: bounds.weekColor,
      weekKey: bounds.weekKey,
    } as DataTableRow)

    for (const row of weekRows) {
      out.push(mapDailyRowToTableRow(row, dailyCostPerTicketByDate, dailyTotalLaborCostByDate))
    }

    out.push(
      buildWeekSummaryFooterRow(
        weekRows,
        bounds,
        weekIndex,
        dailyCostPerTicketByDate,
        dailyTotalLaborCostByDate,
        { label: '本周小计' },
      ),
    )
  })

  out.push(buildAttendanceWindowFooterRow(params))
  return out
}
