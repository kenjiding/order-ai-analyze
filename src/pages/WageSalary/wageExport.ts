import { endOfWeek, format, startOfWeek } from 'date-fns'
import { i18n } from '../../i18n'
import type { RateSettings } from '../../payroll/wageRateCalculation'
import { calculateDecimalHours } from './calculations'
import { summarizeBillingVsActualPayout } from './calculations'
import { parseDate } from './dateUtils'

const NS = 'wageSalary'

function wt(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: NS, ...options })
}

/** 从当前批次工资记录推导考勤表日期区间（yyyy-MM-dd 或 start_end） */
export function deriveAttendanceDateRangeLabel(
  records: Array<{ date?: string | null }>,
): string | null {
  let min = ''
  let max = ''
  for (const r of records) {
    const d = String(r.date ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    if (!min || d < min) min = d
    if (!max || d > max) max = d
  }
  if (!min) return null
  return min === max ? min : `${min}_${max}`
}

export function buildWageExportFileName(dateRangeLabel: string | null): string {
  const period = dateRangeLabel ?? new Date().toISOString().slice(0, 10)
  return wt('export.fileName', { period })
}

/** API 载入的有效考勤行 →「每日原始考勤记录」工作表（列名与考勤上传表一致） */
export function buildDailyRawAttendanceExportRows(
  uploadedData: Record<string, unknown>[],
): Record<string, string>[] {
  return uploadedData.map((record) => ({
    [wt('export.colEmployeeId')]: String(record.employeeId ?? ''),
    [wt('export.colName')]: String(record.name ?? ''),
    [wt('export.colSurname')]: String(record.surname ?? ''),
    [wt('export.colNickname')]: String(record.nickname ?? ''),
    [wt('export.colPositionTitle')]: String(record.positionTitle ?? ''),
    [wt('export.colDate')]: String(record.date ?? ''),
    [wt('export.colWorkday')]: String(record.workday ?? ''),
    [wt('export.colFirstClockIn')]: String(record.firstClockIn ?? ''),
    [wt('export.colLastClockOut')]: String(record.lastClockOut ?? ''),
    [wt('export.colTotalHours')]: String(record.totalHours ?? ''),
    [wt('export.colWorkHours')]: String(record.workHours ?? record.effectiveHours ?? ''),
    [wt('export.colDeduction')]: String(record.deduction ?? ''),
    [wt('export.colReward')]: String(record.reward ?? ''),
  }))
}

type EmployeeAttendanceDetailRow = {
  employeeId: string
  name: string
  nickname: string
  date: string
  firstClockIn: string
  lastClockOut: string
  workHoursDecimal: number
  reward: string
}

function employeeAttendanceGroupKey(row: EmployeeAttendanceDetailRow): string {
  const nick = row.nickname.trim()
  return nick ? `${row.employeeId}_${nick}` : `${row.employeeId}_${row.name.trim()}`
}

function employeeAttendanceSortKey(row: EmployeeAttendanceDetailRow): string {
  const nick = row.nickname.trim().toLowerCase()
  const name = row.name.trim().toLowerCase()
  return nick || name || row.employeeId
}

/** 每日原始考勤 / 工资记录 →「员工考勤详情」工作表（按员工分组，含合计工时） */
export function buildEmployeeAttendanceDetailExportRows(
  sourceRows: Record<string, unknown>[],
): Record<string, string | number>[] {
  const normalized: EmployeeAttendanceDetailRow[] = []

  for (const row of sourceRows) {
    const workHoursSource =
      row.工作时长 ?? row.workHours ?? row.effectiveHours ?? row.totalHoursDecimal
    const workHoursDecimal = calculateDecimalHours(workHoursSource as string | number)
    if (!Number.isFinite(workHoursDecimal) || workHoursDecimal <= 0) continue

    const dateRaw = String(row.日期 ?? row.date ?? '').trim()
    const date = dateRaw.slice(0, 10)
    if (!date) continue

    normalized.push({
      employeeId: String(row.人员编号 ?? row.employeeId ?? ''),
      name: String(row.姓名 ?? row.name ?? ''),
      nickname: String(row.昵称 ?? row.nickname ?? ''),
      date,
      firstClockIn: String(row.实际签到时间 ?? row.firstClockIn ?? ''),
      lastClockOut: String(row.实际签退时间 ?? row.lastClockOut ?? ''),
      workHoursDecimal,
      reward: String(row.奖励 ?? row.reward ?? ''),
    })
  }

  const groupMap = new Map<string, EmployeeAttendanceDetailRow[]>()
  for (const row of normalized) {
    const key = employeeAttendanceGroupKey(row)
    const bucket = groupMap.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      groupMap.set(key, [row])
    }
  }

  const sortedGroups = Array.from(groupMap.entries()).sort(([, leftRows], [, rightRows]) =>
    employeeAttendanceSortKey(leftRows[0]).localeCompare(
      employeeAttendanceSortKey(rightRows[0]),
      'zh-CN',
    ),
  )

  const exportRows: Record<string, string | number>[] = []
  const colName = wt('export.colName')
  const colNickname = wt('export.colNickname')
  const colDate = wt('export.colDate')
  const colFirstClockIn = wt('export.colFirstClockIn')
  const colLastClockOut = wt('export.colLastClockOut')
  const colReward = wt('export.colReward')
  const colWorkHours = wt('export.colWorkHours')
  const colTotal = wt('export.colTotal')

  for (const [, dailyRows] of sortedGroups) {
    dailyRows.sort((a, b) => a.date.localeCompare(b.date))

    let totalHours = 0
    for (const row of dailyRows) {
      totalHours += row.workHoursDecimal
      exportRows.push({
        [colName]: row.name,
        [colNickname]: row.nickname,
        [colDate]: row.date,
        [colFirstClockIn]: row.firstClockIn,
        [colLastClockOut]: row.lastClockOut,
        [colReward]: row.reward,
        [colWorkHours]: Number(row.workHoursDecimal.toFixed(2)),
      })
    }

    const head = dailyRows[0]
    exportRows.push({
      [colName]: head.name,
      [colNickname]: head.nickname,
      [colDate]: colTotal,
      [colFirstClockIn]: '',
      [colLastClockOut]: '',
      [colReward]: '',
      [colWorkHours]: Number(totalHours.toFixed(2)),
    })
  }

  return exportRows
}

/** 与「时薪标准设置」弹窗一致，供导出「时薪标准」工作表 */
export function buildRateSettingsExportRows(
  rateSettings: RateSettings,
  roleOrder: readonly string[],
): Record<string, string | number>[] {
  const colRole = wt('export.colRole')
  const colWorkdayRate = wt('export.colWorkdayRate')
  const colSortingWeekendRate = wt('export.colSortingWeekendRate')
  const colPublicHolidayRate = wt('export.colPublicHolidayRate')

  return roleOrder
    .filter((role) => rateSettings[role])
    .map((role) => ({
      [colRole]: wt(`role.${role}`),
      [colWorkdayRate]: Number(rateSettings[role].workday),
      [colSortingWeekendRate]: Number(rateSettings[role].sortingWeekend),
      [colPublicHolidayRate]: Number(rateSettings[role].publicHoliday),
    }))
}

type WageExportRecord = {
  date?: string | undefined
  totalWage: number | string
  totalHoursDecimal: number | string
  role: string
  workday?: string | undefined
  isSorting: boolean
  isPublicHoliday: boolean
}

function getWeekLabel(dateValue: unknown): string | null {
  const date = parseDate(dateValue)
  if (!date) return null
  const weekStart = startOfWeek(date, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(date, { weekStartsOn: 1 })
  return `${format(weekStart, 'yyyy-MM-dd')} ~ ${format(weekEnd, 'yyyy-MM-dd')}`
}

export function buildWeeklyBillingSummaryRows(
  records: WageExportRecord[],
  actualWorkerRateSettings: RateSettings,
): Record<string, string | number>[] {
  const weekMap = new Map<string, WageExportRecord[]>()
  const invalidDateRecords: WageExportRecord[] = []

  for (const record of records) {
    const weekLabel = getWeekLabel(record.date)
    if (!weekLabel) {
      invalidDateRecords.push(record)
      continue
    }
    const bucket = weekMap.get(weekLabel)
    if (bucket) {
      bucket.push(record)
    } else {
      weekMap.set(weekLabel, [record])
    }
  }

  const colWeek = wt('export.colWeekDimension')
  const colBilling = wt('export.colBillingTotal')
  const colActual = wt('export.colActualPayoutTotal')
  const colMargin = wt('export.colSupplierMargin')
  const colTotal = wt('export.colTotal')

  const rows = Array.from(weekMap.entries())
    .sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel))
    .map(([weekLabel, weekRecords]) => {
      const summary = summarizeBillingVsActualPayout(weekRecords, actualWorkerRateSettings)
      return {
        [colWeek]: weekLabel,
        [colBilling]: Number(summary.totalBilling.toFixed(2)),
        [colActual]: Number(summary.totalActualPayout.toFixed(2)),
        [colMargin]: Number(summary.supplierMargin.toFixed(2)),
      }
    })

  if (invalidDateRecords.length > 0) {
    const summary = summarizeBillingVsActualPayout(invalidDateRecords, actualWorkerRateSettings)
    rows.push({
      [colWeek]: wt('export.invalidDateWeek'),
      [colBilling]: Number(summary.totalBilling.toFixed(2)),
      [colActual]: Number(summary.totalActualPayout.toFixed(2)),
      [colMargin]: Number(summary.supplierMargin.toFixed(2)),
    })
  }

  const grandSummary = summarizeBillingVsActualPayout(records, actualWorkerRateSettings)
  rows.push({
    [colWeek]: colTotal,
    [colBilling]: Number(grandSummary.totalBilling.toFixed(2)),
    [colActual]: Number(grandSummary.totalActualPayout.toFixed(2)),
    [colMargin]: Number(grandSummary.supplierMargin.toFixed(2)),
  })

  return rows
}

export function buildMergedNicknameExportRows(
  mergedRows: Array<{
    name: string
    nickname: string
    surname: string
    totalHoursDecimal: number
    totalWage: number
  }>,
  totals: { totalHours: number; totalWage: number },
): Record<string, string | number>[] {
  const colName = wt('export.colName')
  const colNickname = wt('export.colNickname')
  const colSurname = wt('export.colSurname')
  const colTotalHours = wt('export.colTotalHours')
  const colTotalPrice = wt('export.colTotalPrice')
  const colTotal = wt('export.colTotal')

  const exportData = mergedRows.map((row) => ({
    [colName]: row.name || '',
    [colNickname]: row.nickname || '',
    [colSurname]: row.surname || '',
    [colTotalHours]: Number(row.totalHoursDecimal.toFixed(2)),
    [colTotalPrice]: Number(row.totalWage.toFixed(2)),
  }))

  exportData.push({
    [colName]: colTotal,
    [colNickname]: '',
    [colSurname]: '',
    [colTotalHours]: Number(totals.totalHours.toFixed(2)),
    [colTotalPrice]: Number(totals.totalWage.toFixed(2)),
  })

  return exportData
}
