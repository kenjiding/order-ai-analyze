import type { RateSettings } from '../../payroll/wageRateCalculation'

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
