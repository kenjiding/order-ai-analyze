import { generateId } from '../../utils/generateId'
import {
  calculateDecimalHours,
  calculateHourlyRate,
  calculatePayrollWage,
  type RateSettings,
} from './calculations'
import { convertDateToStandard } from './dateUtils'

export type SubmitValidationError = {
  index: number
  employeeId: string
  label: string
  error: string
}

export type NormalizedSubmitRow = {
  employeeId: string
  /** 导入表「姓名」，仅展示/导出 */
  name: string
  surname: string
  nickname: string
  department: string
  date: string
  workday: string
  firstClockIn: string
  lastClockOut: string
  /** 原表「总时长」仅展示用，不参与结算计算 */
  totalHours: string | number
  /** 结算口径：优先使用导入表「工作时长」 */
  workHours: string | number
  deduction: string | number
  reward: string | number
  role: string
  positionTitle: string
  isSorting: boolean
  isPublicHoliday: boolean
}

export function normalizeUploadedRowsForSubmit(
  uploadedData: Record<string, unknown>[],
): { validationErrors: SubmitValidationError[]; recordsToSubmit: NormalizedSubmitRow[] } {
  const recordsToSubmit: NormalizedSubmitRow[] = []
  const validationErrors: SubmitValidationError[] = []

  for (let i = 0; i < uploadedData.length; i++) {
    const record = uploadedData[i] as Record<string, unknown>
    const rowLabel =
      String(record.nickname ?? '').trim() ||
      String(record.employeeId ?? '').trim() ||
      '未知'

    const effectiveHours = record.effectiveHours as string | number
    const effectiveHoursDecimal = calculateDecimalHours(effectiveHours)

    if (!record.date || effectiveHoursDecimal <= 0) {
      const missingFields: string[] = []
      if (!record.date) missingFields.push('日期')
      if (effectiveHoursDecimal <= 0) missingFields.push('工作时长')

      validationErrors.push({
        index: i + 1,
        employeeId: String(record.employeeId || '试工'),
        label: rowLabel,
        error: `缺少必填字段: ${missingFields.join('、')}`,
      })
      continue
    }

    const standardDate = convertDateToStandard(record.date)
    if (!standardDate || standardDate.trim() === '') {
      validationErrors.push({
        index: i + 1,
        employeeId: String(record.employeeId || '试工'),
        label: rowLabel,
        error: `日期格式无效: ${record.date}`,
      })
      continue
    }

    let finalEmployeeId = String(record.employeeId || '').trim()
    if (!finalEmployeeId) {
      const datePart = standardDate.replace(/-/g, '')
      const nickPart = String(record.nickname ?? '')
        .trim()
        .substring(0, 12)
        .replace(/\s+/g, '-')
      finalEmployeeId = nickPart
        ? `TEMP-${nickPart}-${datePart}`
        : `TEMP-${datePart}-row${i + 1}`
    }

    const recordIsPublicHoliday = record.weekendOption === 'publicHoliday'
    const recordIsSorting = record.weekendOption === 'sorting'

    recordsToSubmit.push({
      employeeId: finalEmployeeId,
      name: String(record.name ?? ''),
      surname: String(record.surname ?? ''),
      nickname: String(record.nickname ?? ''),
      department: String(record.department ?? ''),
      date: standardDate,
      workday: String(record.workday ?? ''),
      firstClockIn: String(record.firstClockIn ?? ''),
      lastClockOut: String(record.lastClockOut ?? ''),
      totalHours: record.totalHours as string | number,
      workHours: effectiveHours,
      deduction: String(record.deduction ?? ''),
      reward: String(record.reward ?? ''),
      role: String(record.role || 'worker'),
      positionTitle: String(record.positionTitle ?? ''),
      isSorting: recordIsSorting,
      isPublicHoliday: recordIsPublicHoliday,
    })
  }

  return { validationErrors, recordsToSubmit }
}

/** 同一人员编号、同一天可存在多条打卡（如「昵称」Tong 与 Tong-D）；结算需分行，不能按编号+日期合并。 */
function payrollDedupKey(rec: NormalizedSubmitRow): string {
  const nick = String(rec.nickname ?? '').trim()
  return `${rec.employeeId}_${rec.date}_${nick}`
}

export function buildWageRowsFromNormalized(
  recordsToSubmit: NormalizedSubmitRow[],
  rateSettings: RateSettings,
): Array<Record<string, unknown>> {
  const dupMap = new Map<string, Record<string, unknown>>()

  for (const rec of recordsToSubmit) {
    const hourlyRate = calculateHourlyRate(
      rec.role,
      rec.workday,
      rec.isSorting,
      rec.isPublicHoliday,
      rateSettings,
    )
    const { totalHoursDecimal, totalWage } = calculatePayrollWage(rec.workHours, hourlyRate)

    const row = {
      _id: generateId(),
      employeeId: rec.employeeId,
      name: rec.name || '',
      surname: rec.surname || '',
      nickname: rec.nickname || '',
      department: rec.department || '',
      date: rec.date,
      workday: rec.workday || '',
      firstClockIn: rec.firstClockIn || '',
      lastClockOut: rec.lastClockOut || '',
      totalHours: rec.totalHours,
      workHours: rec.workHours,
      deduction: rec.deduction,
      reward: rec.reward,
      role: rec.role || 'worker',
      positionTitle: rec.positionTitle || '',
      isSorting: rec.isSorting,
      isPublicHoliday: rec.isPublicHoliday,
      hourlyRate,
      totalHoursDecimal,
      totalWage,
    }
    dupMap.set(payrollDedupKey(rec), row)
  }

  return Array.from(dupMap.values())
}
