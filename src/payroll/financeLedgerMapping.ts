import { convertDateToStandard } from './attendanceDate'
import { cellStringFromSheetRow, cellValueFromSheetRow } from './sheetCellLookup'

const FINANCE_AMOUNT_KEYS = [
  '不含税金额/Excluding tax amount',
  '不含税金额',
  'Excluding tax amount',
  'Excluding Tax Amount',
  'excludingTaxAmount',
] as const

/** 财务侧已提供十进制出勤小时，原样展示，不做考勤口径的时长解析 */
const FINANCE_HOURS_KEYS = [
  '出勤小时/Attendance Hours',
  '出勤小时',
  'Attendance Hours',
  'attendanceHours',
] as const

const FINANCE_POSITION_KEYS = [
  '职位/position Name',
  '职位',
  'position Name',
  'Position Name',
  'positionName',
  'Position',
] as const

const FINANCE_PERSON_KEYS = [
  '打卡人员名称/Check-in Personnel Name',
  '打卡人员名称',
  'Check-in Personnel Name',
  'Check-In Personnel Name',
  'checkInPersonnelName',
] as const

const FINANCE_WORKDAY_KEYS = [
  '星期/Day of the Week',
  '星期',
  'Day of the Week',
  'dayOfTheWeek',
  'Workday',
  'workday',
] as const

/** 业务时间为出勤日；账单日期仅作兜底 */
const FINANCE_DATE_KEYS = [
  '业务时间/Business Time',
  '业务时间',
  'Business Time',
  'businessTime',
  '日期',
  'Date',
  'date',
  '账单日期/Bill Date',
  '账单日期',
  'Bill Date',
] as const

function parseFinanceAmount(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return NaN
  const s = String(raw).replace(/[$,\s]/g, '').trim()
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n * 100) / 100
}

/** 财务出勤小时：保留原值展示，数值仅用于求和/差额（parseFloat，非考勤十进制转换） */
function parseFinanceAttendanceHours(raw: unknown): { raw: string; numeric: number } {
  if (raw === undefined || raw === null || raw === '') {
    return { raw: '', numeric: NaN }
  }
  const rawStr = String(raw).trim()
  const n = parseFloat(rawStr.replace(/,/g, ''))
  return {
    raw: rawStr,
    numeric: Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN,
  }
}

export type FinanceLedgerRow = {
  personName: string
  date: string
  workday: string
  positionName: string
  /** 出勤小时原值（与财务表一致） */
  attendanceHoursRaw: string
  /** 出勤小时数值，仅用于汇总与差额 */
  attendanceHours: number
  excludingTaxAmount: number
  /** 原始行号（1-based，含表头偏移）供错误提示 */
  sourceRowIndex: number
}

export type FinanceLedgerParseError = {
  rowIndex: number
  personName: string
  error: string
}

export type FinanceLedgerParseResult = {
  rows: FinanceLedgerRow[]
  parseErrors: FinanceLedgerParseError[]
}

export function parseFinanceLedgerRows(jsonData: Record<string, unknown>[]): FinanceLedgerParseResult {
  const rows: FinanceLedgerRow[] = []
  const parseErrors: FinanceLedgerParseError[] = []

  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i]
    const sourceRowIndex = i + 2
    const personName = cellStringFromSheetRow(row, FINANCE_PERSON_KEYS)
    const dateRaw = cellStringFromSheetRow(row, FINANCE_DATE_KEYS)
    const workday = cellStringFromSheetRow(row, FINANCE_WORKDAY_KEYS)
    const positionName = cellStringFromSheetRow(row, FINANCE_POSITION_KEYS)

    const hoursRaw = cellValueFromSheetRow(row, FINANCE_HOURS_KEYS)
    const amountRaw = cellValueFromSheetRow(row, FINANCE_AMOUNT_KEYS)

    const { raw: attendanceHoursRaw, numeric: attendanceHours } = parseFinanceAttendanceHours(hoursRaw)
    const excludingTaxAmount = parseFinanceAmount(amountRaw)
    const date = convertDateToStandard(dateRaw)

    const missing: string[] = []
    if (!personName) missing.push('打卡人员名称')
    if (!date) missing.push('日期')
    if (!Number.isFinite(attendanceHours) || attendanceHours <= 0) missing.push('出勤小时')
    if (!Number.isFinite(excludingTaxAmount)) missing.push('不含税金额')

    if (missing.length > 0) {
      parseErrors.push({
        rowIndex: sourceRowIndex,
        personName: personName || '未知',
        error: `缺少或无效: ${missing.join('、')}`,
      })
      continue
    }

    rows.push({
      personName,
      date,
      workday,
      positionName,
      attendanceHoursRaw,
      attendanceHours,
      excludingTaxAmount,
      sourceRowIndex,
    })
  }

  return { rows, parseErrors }
}
