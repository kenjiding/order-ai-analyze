/**
 * 出勤文件 → 工资结算同款口径（与工资页上传 → 计算薪资一致）。
 * 物流运营「总成本」应使用本模块，勿再走扫描解析后的二次映射。
 */
import * as XLSX from 'xlsx'
import {
  buildWageRowsFromNormalized,
  normalizeUploadedRowsForSubmit,
  type SubmitValidationError,
} from '../pages/WageSalary/uploadSubmit'
import { transformSheetRowsToUploadedData, type EmployeeLite } from './attendanceSheetMapping'
import { convertDateToStandard } from './attendanceDate'
import type { RateSettings } from './wageRateCalculation'
import type { DailyLaborCostMetrics } from './laborCostFromAttendance'

/** 与工资页 `useWageSalaryPage` 读取考勤 CSV/Excel 的选项一致 */
const WAGE_XLSX_READ_OPTS = {
  cellDates: false,
  raw: false,
  dateNF: 'dd/mm/yyyy',
} as const

export type AttendancePayrollResult = {
  wageRows: Array<{
    date: string
    totalWage: number
    totalHoursDecimal: number
    employeeId: string
  }>
  /** 与工资页页头「总工资」相同：全部有效行 totalWage 之和 */
  totalWages: number
  wagesByDate: Record<string, number>
  validationErrors: SubmitValidationError[]
}

async function readSheetRowsFromFile(file: File): Promise<Record<string, unknown>[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'csv') {
    const text = await file.text()
    const workbook = XLSX.read(text, { type: 'string', ...WAGE_XLSX_READ_OPTS })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]
    if (!worksheet) return []
    return XLSX.utils.sheet_to_json(worksheet, { raw: false }) as Record<string, unknown>[]
  }
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', ...WAGE_XLSX_READ_OPTS })
  const worksheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!worksheet) return []
  return XLSX.utils.sheet_to_json(worksheet, { raw: false }) as Record<string, unknown>[]
}

function attendanceUploadRowKey(row: Record<string, unknown>): string {
  const dateRaw = row['日期'] ?? row['Date'] ?? row['date'] ?? ''
  const date = convertDateToStandard(String(dateRaw)) || String(dateRaw).trim()
  const id = String(row['人员编号'] ?? row['Employee ID'] ?? row['employeeId'] ?? '').trim()
  const nick = String(row['昵称'] ?? row['Nickname'] ?? row['nickname'] ?? '').trim()
  const name = String(row['姓名'] ?? row['Name'] ?? row['name'] ?? '').trim()
  const person = id || nick || name
  if (!date || !person) return ''
  return `${date}|${person}`
}

/** 叠加上传时同人同日保留首条，与物流运营考勤解析去重口径一致 */
function dedupeAttendanceUploadRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    const key = attendanceUploadRowKey(row)
    if (!key) {
      out.push(row)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function buildAttendancePayrollResult(
  jsonData: Record<string, unknown>[],
  employees: EmployeeLite[],
  rateSettings: RateSettings,
): AttendancePayrollResult {
  const uploadedData = transformSheetRowsToUploadedData(
    dedupeAttendanceUploadRows(jsonData),
    employees,
  )
  const { validationErrors, recordsToSubmit } = normalizeUploadedRowsForSubmit(uploadedData)
  const computed = buildWageRowsFromNormalized(recordsToSubmit, rateSettings)

  const wagesByDate: Record<string, number> = {}
  let totalWages = 0
  const wageRows: AttendancePayrollResult['wageRows'] = []

  for (const row of computed) {
    const date = convertDateToStandard(String(row.date ?? '')) || String(row.date ?? '')
    const totalWage = Number(row.totalWage) || 0
    if (!date) continue
    totalWages += totalWage
    wagesByDate[date] = (wagesByDate[date] ?? 0) + totalWage
    wageRows.push({
      date,
      totalWage,
      totalHoursDecimal: Number(row.totalHoursDecimal) || 0,
      employeeId: String(row.employeeId ?? ''),
    })
  }

  return { wageRows, totalWages, wagesByDate, validationErrors }
}

/** 考勤表行（上传表 / ZKT API 映射）→ 工资结算同款口径 */
export function computeAttendancePayrollFromSheetRows(
  sheetRows: Record<string, unknown>[],
  employees: EmployeeLite[],
  rateSettings: RateSettings,
): AttendancePayrollResult {
  if (!sheetRows.length) {
    return { wageRows: [], totalWages: 0, wagesByDate: {}, validationErrors: [] }
  }
  return buildAttendancePayrollResult(sheetRows, employees, rateSettings)
}

/** 按工资结算系统同一流程计算考勤工资（日配置由导入后自动推断，工资页可在预览中逐行调整）。 */
export async function computeAttendancePayrollFromFiles(
  files: File[],
  employees: EmployeeLite[],
  rateSettings: RateSettings,
): Promise<AttendancePayrollResult> {
  if (!files.length) {
    return { wageRows: [], totalWages: 0, wagesByDate: {}, validationErrors: [] }
  }

  const jsonData: Record<string, unknown>[] = []
  for (const file of files) {
    jsonData.push(...(await readSheetRowsFromFile(file)))
  }

  return buildAttendancePayrollResult(jsonData, employees, rateSettings)
}

type DailyRowForLaborCost = {
  date: string
  hasAttendance: boolean
  volume: number
}

/** 按日总成本 = 当日工资合计；单位成本 = 总成本 ÷ 总货量 */
export function buildDailyLaborCostFromPayrollByDate(
  dailyRows: ReadonlyArray<DailyRowForLaborCost>,
  wagesByDate: Record<string, number> | undefined,
): Record<string, DailyLaborCostMetrics> {
  if (!dailyRows.length || !wagesByDate) return {}
  const rec: Record<string, DailyLaborCostMetrics> = {}
  for (const r of dailyRows) {
    if (!r.hasAttendance) {
      rec[r.date] = { totalLaborCost: null, costPerTicket: null }
      continue
    }
    const totalLaborCost = wagesByDate[r.date] ?? 0
    rec[r.date] = {
      totalLaborCost,
      costPerTicket: r.volume > 0 ? totalLaborCost / r.volume : null,
    }
  }
  return rec
}
