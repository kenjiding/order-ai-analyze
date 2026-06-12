/** 对账时薪、工时小数与行金额；与分拣工资页及历史 server 口径对齐。 */

export type RateBand = { workday: number; sortingWeekend: number; publicHoliday: number }

export type RateSettings = Record<string, RateBand>

const fallbackWorker: RateBand = {
  workday: 34.44,
  sortingWeekend: 43.05,
  publicHoliday: 86.1,
}

export function calculateHourlyRate(
  role: string,
  workday: string | undefined,
  isSorting: boolean,
  isPublicHoliday: boolean,
  rateSettings: RateSettings,
): number {
  const rates = rateSettings
  const roleRates = rates[role] || rates.worker || { ...fallbackWorker }

  if (isPublicHoliday) {
    return roleRates.publicHoliday
  }

  const dayName = workday?.trim().toLowerCase() ?? ''
  const isWeekend =
    dayName === '周六' ||
    dayName === '周日' ||
    dayName === 'saturday' ||
    dayName === 'sunday' ||
    dayName === '星期六' ||
    dayName === '星期日'

  if (isWeekend) {
    return isSorting ? roleRates.sortingWeekend : roleRates.workday
  }
  return roleRates.workday
}

/** 单行「人时」不可能超过该值时视为脏数据（如时间戳误写入总时长列） */
const MAX_HOURS_PER_ATTENDANCE_ROW = 24 * 62

/**
 * 与 Excel / WPS `=HOUR(serial)+MINUTE(serial)/60` 一致：
 * 仅取 serial 的小数部分为「日内时间」，再按时钟的时、分折算（秒不参与小数）。
 */
function decimalHoursLikeExcelHourMinuteFromSerial(serial: number): number {
  if (!Number.isFinite(serial) || serial <= 0) return 0
  const intPart = Math.floor(serial)
  const frac = serial - intPart
  if (frac <= 0) return 0

  let totalSeconds = Math.round(frac * 86400)
  if (totalSeconds < 0) totalSeconds = 0
  if (totalSeconds >= 86400) totalSeconds = 86399

  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  return h + m / 60
}

/** 工资结算：十进制工时保留 2 位小数后再参与乘时薪（如 10:11 → 10.18） */
function roundDecimalHoursForPayroll(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0
  if (hours > MAX_HOURS_PER_ATTENDANCE_ROW) return 0
  return Math.round(hours * 100) / 100
}

function parseDecimalHoursRaw(totalHours: string | number): number {
  if (typeof totalHours === 'number' && Number.isFinite(totalHours)) {
    if (totalHours <= 0) return 0
    if (totalHours > MAX_HOURS_PER_ATTENDANCE_ROW) return 0
    // 仓库效率等已解析为「十进制小时」(如 8.5) 的数值必须直读；仅 (0,1] 视为 Excel 日内时间分数
    if (totalHours > 1) return totalHours
    return decimalHoursLikeExcelHourMinuteFromSerial(totalHours)
  }

  const timeStr = String(totalHours ?? '').trim()
  if (!timeStr) return 0

  if (timeStr.includes(':')) {
    const parts = timeStr.split(':')
    const hours = parseInt(parts[0], 10) || 0
    const minutes = parseInt(parts[1], 10) || 0
    return hours + minutes / 60
  }

  if (timeStr.includes('.')) {
    const parts = timeStr.split('.')
    const hours = parseInt(parts[0], 10) || 0
    const minutes = parseInt(parts[1], 10) || 0
    return hours + minutes / 60
  }

  return parseFloat(timeStr) || 0
}

export function calculateDecimalHours(totalHours: string | number): number {
  return roundDecimalHoursForPayroll(parseDecimalHoursRaw(totalHours))
}

/** 工资结算：十进制工时（2 位小数）× 时薪，金额再保留 2 位小数 */
export function calculatePayrollWage(
  hoursSource: string | number,
  hourlyRate: number,
): { totalHoursDecimal: number; totalWage: number } {
  const totalHoursDecimal = calculateDecimalHours(hoursSource)
  if (totalHoursDecimal <= 0 || !Number.isFinite(hourlyRate)) {
    return { totalHoursDecimal: 0, totalWage: 0 }
  }
  const totalWage = Math.round(totalHoursDecimal * hourlyRate * 100) / 100
  return { totalHoursDecimal, totalWage }
}

export function recalcWageAmounts<
  R extends {
    totalHours: string | number
    workHours?: string | number
    role: string
    workday?: string
    isSorting: boolean
    isPublicHoliday: boolean
  },
>(record: R, rateSettings: RateSettings): R & { hourlyRate: number; totalHoursDecimal: number; totalWage: number } {
  const hoursSource = record.workHours ?? record.totalHours
  const hourlyRate = calculateHourlyRate(
    record.role,
    record.workday,
    record.isSorting,
    record.isPublicHoliday,
    rateSettings,
  )
  const { totalHoursDecimal, totalWage } = calculatePayrollWage(hoursSource, hourlyRate)
  return {
    ...record,
    hourlyRate,
    totalHoursDecimal,
    totalWage,
  }
}

/** 对账金额（记录内 totalWage）与按「实际发放时薪」测算的小工应发；差额常理解为供应商在该批人力上的毛利空间。 */
export function summarizeBillingVsActualPayout(
  records: Array<{
    totalWage: number | string
    totalHoursDecimal: number | string
    role: string
    workday?: string
    isSorting: boolean
    isPublicHoliday: boolean
  }>,
  actualPayoutRates: RateSettings,
): { totalBilling: number; totalActualPayout: number; supplierMargin: number } {
  let totalBilling = 0
  let totalActualPayout = 0
  for (const r of records) {
    const billing = Number(r.totalWage) || 0
    const h = Number(r.totalHoursDecimal) || 0
    const actualHourly = calculateHourlyRate(
      r.role,
      r.workday,
      r.isSorting,
      r.isPublicHoliday,
      actualPayoutRates,
    )
    totalBilling += billing
    totalActualPayout += h * actualHourly
  }
  return {
    totalBilling,
    totalActualPayout,
    supplierMargin: totalBilling - totalActualPayout,
  }
}
