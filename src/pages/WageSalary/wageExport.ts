import { endOfWeek, format, startOfWeek } from 'date-fns'
import type { RateSettings } from '../../payroll/wageRateCalculation'
import { summarizeBillingVsActualPayout } from './calculations'
import { parseDate } from './dateUtils'

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
  return `工资数据_${period}.xlsx`
}

/** API 载入的有效考勤行 →「每日原始考勤记录」工作表（列名与考勤上传表一致） */
export function buildDailyRawAttendanceExportRows(
  uploadedData: Record<string, unknown>[],
): Record<string, string>[] {
  return uploadedData.map((record) => ({
    人员编号: String(record.employeeId ?? ''),
    姓名: String(record.name ?? ''),
    姓氏: String(record.surname ?? ''),
    昵称: String(record.nickname ?? ''),
    职位名称: String(record.positionTitle ?? ''),
    日期: String(record.date ?? ''),
    工作日: String(record.workday ?? ''),
    实际签到时间: String(record.firstClockIn ?? ''),
    实际签退时间: String(record.lastClockOut ?? ''),
    总时长: String(record.totalHours ?? ''),
    工作时长: String(record.workHours ?? record.effectiveHours ?? ''),
    扣减: String(record.deduction ?? ''),
    奖励: String(record.reward ?? ''),
  }))
}

/** 与「时薪标准设置」弹窗一致，供导出「时薪标准」工作表 */
export function buildRateSettingsExportRows(
  rateSettings: RateSettings,
  roleMap: Record<string, string>,
  roleOrder: readonly string[],
): Record<string, string | number>[] {
  return roleOrder
    .filter((role) => rateSettings[role])
    .map((role) => ({
      角色: roleMap[role] ?? role,
      工作日时薪: Number(rateSettings[role].workday),
      分拣周末时薪: Number(rateSettings[role].sortingWeekend),
      公共节假日时薪: Number(rateSettings[role].publicHoliday),
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

  const rows = Array.from(weekMap.entries())
    .sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel))
    .map(([weekLabel, weekRecords]) => {
      const summary = summarizeBillingVsActualPayout(weekRecords, actualWorkerRateSettings)
      return {
        周维度: weekLabel,
        '对账 / 导出总额': Number(summary.totalBilling.toFixed(2)),
        '小工实际到手合计': Number(summary.totalActualPayout.toFixed(2)),
        '供应商赚取差额（对账 − 实际）': Number(summary.supplierMargin.toFixed(2)),
      }
    })

  if (invalidDateRecords.length > 0) {
    const summary = summarizeBillingVsActualPayout(invalidDateRecords, actualWorkerRateSettings)
    rows.push({
      周维度: '日期无效/缺失',
      '对账 / 导出总额': Number(summary.totalBilling.toFixed(2)),
      '小工实际到手合计': Number(summary.totalActualPayout.toFixed(2)),
      '供应商赚取差额（对账 − 实际）': Number(summary.supplierMargin.toFixed(2)),
    })
  }

  const grandSummary = summarizeBillingVsActualPayout(records, actualWorkerRateSettings)
  rows.push({
    周维度: '合计',
    '对账 / 导出总额': Number(grandSummary.totalBilling.toFixed(2)),
    '小工实际到手合计': Number(grandSummary.totalActualPayout.toFixed(2)),
    '供应商赚取差额（对账 − 实际）': Number(grandSummary.supplierMargin.toFixed(2)),
  })

  return rows
}
