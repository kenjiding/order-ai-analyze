import { transformSheetRowsToUploadedData, type EmployeeLite } from './attendanceSheetMapping'
import { convertDateToStandard } from './attendanceDate'
import {
  calculateDecimalHours,
  calculateHourlyRate,
  calculatePayrollWage,
  type RateSettings,
} from './wageRateCalculation'

/** 将已解析的十进制小时格式化为工资页 colon 口径，避免 "8.5" 被当成 8 小时 5 分 */
function formatDecimalHoursForPayrollField(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return ''
  const whole = Math.floor(hours + 1e-9)
  const minutes = Math.round((hours - whole) * 60)
  const m = minutes >= 60 ? 0 : minutes
  const h = minutes >= 60 ? whole + 1 : whole
  return `${h}:${String(m).padStart(2, '0')}`
}

/** 与工资页 `payrollDedupKey` 一致：同人同日同昵称只保留最后一行 */
function dedupeMappedPayrollRecords(
  mappedRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>()
  for (const record of mappedRows) {
    const date = convertDateToStandard(record.date ?? '')
    const nick = String(record.nickname ?? '').trim()
    const id = String(record.employeeId ?? '').trim()
    const key = `${id}_${date}_${nick}`
    map.set(key, record)
  }
  return Array.from(map.values())
}

/** 与 `buildWageRowsFromNormalized` 单行一致：工时 × 对账时薪 */
export function payrollWageForMappedRecord(
  record: Record<string, unknown>,
  rateSettings: RateSettings,
): number {
  const hoursSource =
    (record.effectiveHours as string | number) ??
    (record.workHours as string | number) ??
    (record.totalHours as string | number)
  const isPh = record.weekendOption === 'publicHoliday'
  const isSort = record.weekendOption === 'sorting'
  const rate = calculateHourlyRate(
    String(record.role || 'worker'),
    String(record.workday ?? ''),
    isSort,
    isPh,
    rateSettings,
  )
  return calculatePayrollWage(hoursSource, rate).totalWage
}

/** 与仓库效率工作台解析后的考勤行兼容 */
export type ParsedAttendanceRowForLabor = {
  date: string
  sorterKey: string
  sorterName: string
  nameNick: string
  nameFull: string
  hours: number
  workday?: string
  surname?: string
  /** 与工资考勤表一致，用于 `resolveRoleFromAttendanceRow` */
  positionTitle?: string
  positionCode?: string
}

function attendanceRowToSheetRecord(row: ParsedAttendanceRowForLabor): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    人员编号: row.sorterKey,
    昵称: row.nameNick || '',
    姓名: row.nameFull || row.sorterName || '',
    姓氏: row.surname ?? '',
    工作日: row.workday ?? '',
    日期: row.date,
    总时长: formatDecimalHoursForPayrollField(row.hours),
    工作时长: formatDecimalHoursForPayrollField(row.hours),
  }
  if (row.positionTitle?.trim()) {
    rec['职位名称'] = row.positionTitle.trim()
  }
  if (row.positionCode?.trim()) {
    rec['职位编号'] = row.positionCode.trim()
  }
  return rec
}

/** 与工资页一致的字段映射后再汇总工时 × 对账时薪（按行 weekendOption / role / workday）。 */
export function mapParsedAttendanceRowsForLabor(
  rows: ParsedAttendanceRowForLabor[],
  employees: EmployeeLite[],
): Record<string, unknown>[] {
  if (!rows.length) return []
  const sheet = rows.map(attendanceRowToSheetRecord)
  return transformSheetRowsToUploadedData(sheet, employees)
}

/** 统计窗口内：每日人工总成本 + 每日映射行工时合计（与成本共用同一套工时解析，用于修正 UI 覆盖总工时）。 */
export function laborCostAndHoursSumByDateFromMappedRows(
  mappedRows: Record<string, unknown>[],
  rateSettings: RateSettings,
  dateInWindow: (isoDate: string) => boolean,
): { costByDate: Map<string, number>; hoursSumByDate: Map<string, number> } {
  const costByDate = new Map<string, number>()
  const hoursSumByDate = new Map<string, number>()
  for (const record of dedupeMappedPayrollRecords(mappedRows)) {
    const d = convertDateToStandard(record.date ?? '')
    if (!d || !dateInWindow(d)) continue

    const wage = payrollWageForMappedRecord(record, rateSettings)
    if (!(wage > 0)) continue
    const h = calculateDecimalHours(
      (record.effectiveHours as string | number) ??
        (record.workHours as string | number) ??
        (record.totalHours as string | number),
    )
    costByDate.set(d, (costByDate.get(d) ?? 0) + wage)
    hoursSumByDate.set(d, (hoursSumByDate.get(d) ?? 0) + h)
  }
  return { costByDate, hoursSumByDate }
}

export function laborCostByDateFromMappedRows(
  mappedRows: Record<string, unknown>[],
  rateSettings: RateSettings,
  dateInWindow: (isoDate: string) => boolean,
): Map<string, number> {
  return laborCostAndHoursSumByDateFromMappedRows(mappedRows, rateSettings, dateInWindow).costByDate
}

/** 整张出勤表映射结果的工资合计（与工资页「总工资」同口径，含表外日期） */
export function sumTotalPayrollLaborFromMappedRows(
  mappedRows: Record<string, unknown>[],
  rateSettings: RateSettings,
): number {
  let total = 0
  for (const record of dedupeMappedPayrollRecords(mappedRows)) {
    total += payrollWageForMappedRecord(record, rateSettings)
  }
  return total
}

export function sumTotalLaborCostFromCostByDate(costByDate: Map<string, number>): number {
  let total = 0
  for (const v of costByDate.values()) total += v
  return total
}

export function sumLaborCostFromMappedRows(
  mappedRows: Record<string, unknown>[],
  rateSettings: RateSettings,
  dateInWindow: (isoDate: string) => boolean,
  openDayPredicate?: (isoDate: string) => boolean,
): { laborAll: number; laborOpenDays: number } {
  const byDate = laborCostByDateFromMappedRows(mappedRows, rateSettings, dateInWindow)
  let laborAll = 0
  let laborOpenDays = 0
  for (const [d, v] of byDate) {
    laborAll += v
    if (openDayPredicate?.(d)) laborOpenDays += v
  }
  return { laborAll, laborOpenDays }
}

export type PerTicketLaborCost = {
  uploadedVolume: number
  laborAll: number
  laborOpenDays: number
  costPerTicketOverall: number | null
  costPerTicketOpen: number | null
}

/** 与仓库效率「效率明细/天」、排班计划「总成本/每票成本」共用的按日人工口径 */
export type DailyLaborCostMetrics = {
  totalLaborCost: number | null
  costPerTicket: number | null
}

type DailyRowForLaborCost = {
  date: string
  hasAttendance: boolean
  volume: number
}

/**
 * 按日汇总：与工资结算一致，当日出勤表各行「工时 × 对账时薪」之和为 totalLaborCost；
 * 单位成本（每票）= 当日总成本 ÷ 当日总货量（货量为 0 时不算单位成本）。
 */
export function buildDailyLaborCostByDate(
  dailyRows: ReadonlyArray<DailyRowForLaborCost>,
  laborByDateAndHours: { costByDate: Map<string, number>; hoursSumByDate: Map<string, number> } | null | undefined,
): Record<string, DailyLaborCostMetrics> {
  if (!dailyRows.length || !laborByDateAndHours) return {}
  const { costByDate: laborByDate } = laborByDateAndHours
  const rec: Record<string, DailyLaborCostMetrics> = {}
  for (const r of dailyRows) {
    if (!r.hasAttendance) {
      rec[r.date] = { totalLaborCost: null, costPerTicket: null }
      continue
    }
    const totalLaborCost = laborByDate.get(r.date) ?? 0
    rec[r.date] = {
      totalLaborCost,
      costPerTicket: r.volume > 0 ? totalLaborCost / r.volume : null,
    }
  }
  return rec
}

export function perTicketCostFromLabor(
  uploadedVolume: number,
  laborAll: number,
  laborOpenDays: number,
): Pick<PerTicketLaborCost, 'costPerTicketOverall' | 'costPerTicketOpen'> {
  const v = uploadedVolume
  return {
    costPerTicketOverall: v > 0 && Number.isFinite(laborAll) ? laborAll / v : null,
    costPerTicketOpen: v > 0 && Number.isFinite(laborOpenDays) ? laborOpenDays / v : null,
  }
}
