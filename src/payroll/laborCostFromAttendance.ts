import { transformSheetRowsToUploadedData, type EmployeeLite } from './attendanceSheetMapping'
import { convertDateToStandard } from './attendanceDate'
import { calculateDecimalHours, calculateHourlyRate, type RateSettings } from './wageRateCalculation'

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
}

function attendanceRowToSheetRecord(row: ParsedAttendanceRowForLabor): Record<string, unknown> {
  return {
    人员编号: row.sorterKey,
    昵称: row.nameNick || '',
    姓名: row.nameFull || row.sorterName || '',
    姓氏: row.surname ?? '',
    工作日: row.workday ?? '',
    日期: row.date,
    总时长: row.hours,
  }
}

/** 与工资页一致的字段映射后再汇总工时 × 对账时薪（按行 weekendOption / role / workday）。 */
export function mapParsedAttendanceRowsForLabor(
  rows: ParsedAttendanceRowForLabor[],
  employees: EmployeeLite[],
  isSorting: boolean,
  isPublicHoliday: boolean,
): Record<string, unknown>[] {
  if (!rows.length) return []
  const sheet = rows.map(attendanceRowToSheetRecord)
  return transformSheetRowsToUploadedData(sheet, employees, isSorting, isPublicHoliday)
}

/** 统计窗口内：每日人工总成本 + 每日映射行工时合计（与成本共用同一套工时解析，用于修正 UI 覆盖总工时）。 */
export function laborCostAndHoursSumByDateFromMappedRows(
  mappedRows: Record<string, unknown>[],
  rateSettings: RateSettings,
  dateInWindow: (isoDate: string) => boolean,
): { costByDate: Map<string, number>; hoursSumByDate: Map<string, number> } {
  const costByDate = new Map<string, number>()
  const hoursSumByDate = new Map<string, number>()
  for (const record of mappedRows) {
    const d = convertDateToStandard(record.date ?? '')
    if (!d || !dateInWindow(d)) continue

    const h = calculateDecimalHours(record.totalHours as string | number)
    const isPh = record.weekendOption === 'publicHoliday'
    const isSort = record.weekendOption === 'sorting'
    const rate = calculateHourlyRate(
      String(record.role || 'worker'),
      String(record.workday ?? ''),
      isSort,
      isPh,
      rateSettings,
    )
    costByDate.set(d, (costByDate.get(d) ?? 0) + h * rate)
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
