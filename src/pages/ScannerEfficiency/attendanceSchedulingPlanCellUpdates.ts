import {
  applyOperatorExpectedHoursFromClockTimes,
} from './attendanceSchedulingPlanOperators'

const EFFICIENCY_INPUT_KEY = /^(.+:eff-\d+)-(target|actual)$/

function parseEfficiencyNumber(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed === '/') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

/** 达成比例 = 实际计划效率 ÷ 目标效率，展示为四舍五入整数百分比 */
export function computeEfficiencyAchievementRatio(targetText: string, actualText: string): string {
  const target = parseEfficiencyNumber(targetText)
  const actual = parseEfficiencyNumber(actualText)
  if (target == null || actual == null) return ''
  const ratio = actual / target
  if (!Number.isFinite(ratio)) return ''
  return `${Math.round(ratio * 100)}%`
}

function resolveEfficiencyRowRatio(
  prev: Record<string, string>,
  rowPrefix: string,
): string {
  return computeEfficiencyAchievementRatio(
    prev[`${rowPrefix}-target`] ?? '',
    prev[`${rowPrefix}-actual`] ?? '',
  )
}

/** 编辑目标/实际效率后，同步更新同一行的达成比例 */
export function applyEfficiencyAchievementRatio(
  prev: Record<string, string>,
  key: string,
  text: string,
): Record<string, string> {
  const match = key.match(EFFICIENCY_INPUT_KEY)
  if (!match) return prev

  const rowPrefix = match[1]!
  const field = match[2]!
  const next = { ...prev, [key]: text }
  const target = field === 'target' ? text : (next[`${rowPrefix}-target`] ?? '')
  const actual = field === 'actual' ? text : (next[`${rowPrefix}-actual`] ?? '')

  return {
    ...next,
    [`${rowPrefix}-ratio`]: computeEfficiencyAchievementRatio(target, actual),
  }
}

/** 排班计划可编辑单元格变更：出勤工时、效率达成比例等联动 */
export function applyAttendanceSchedulingPlanCellChange(
  prev: Record<string, string>,
  key: string,
  text: string,
): Record<string, string> {
  const withOperatorHours = applyOperatorExpectedHoursFromClockTimes(prev, key, text)
  return applyEfficiencyAchievementRatio(withOperatorHours, key, text)
}

/** 模版回填后，按已填目标/实际效率重算各行达成比例 */
export function recalculateEfficiencyAchievementRatios(
  cellTexts: Record<string, string>,
): Record<string, string> {
  const next = { ...cellTexts }
  const rowPrefixes = new Set<string>()

  for (const key of Object.keys(cellTexts)) {
    const match = key.match(/^(.+:eff-\d+)-(target|actual|ratio)$/)
    if (match) rowPrefixes.add(match[1]!)
  }

  for (const rowPrefix of rowPrefixes) {
    next[`${rowPrefix}-ratio`] = resolveEfficiencyRowRatio(next, rowPrefix)
  }

  return next
}
