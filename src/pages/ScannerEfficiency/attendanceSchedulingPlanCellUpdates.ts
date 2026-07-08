import { computeOperatorExpectedHours } from './attendanceSchedulingPlanOperators'
import { SCHEDULING_PLAN_PROCESSES } from './attendanceSchedulingPlanPreviewModel'

// s2-{idx}-(actual|target) → recompute s2-{idx}-rate
const S2_EFFICIENCY_KEY = /^(.+):s2-(\d+)-(target|actual)$/

// s4-total-count 直接编辑：只传播到 s3b-total-count / s1-count，不触发整体重算
const S4_TOTAL_COUNT_KEY = /^(\d{4}-\d{2}-\d{2}):s4-total-count$/

const PROCESS_COUNT = SCHEDULING_PLAN_PROCESSES.length

// direct processes: forklift(0) + coarse(1) + fine(2); indirect: frontdesk(3)
const DIRECT_PROCESS_INDICES = [0, 1, 2]
const INDIRECT_PROCESS_INDICES = [3]

// ── helpers ──────────────────────────────────────────────────────────────────

export function computeEfficiencyAchievementRatio(targetText: string, actualText: string): string {
  const parsePositive = (t: string) => {
    const n = Number(t.trim())
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const target = parsePositive(targetText)
  const actual = parsePositive(actualText)
  if (target == null || actual == null) return ''
  const r = actual / target
  return Number.isFinite(r) ? `${Math.round(r * 100)}%` : ''
}

function formatHours(n: number): string {
  if (!n || !Number.isFinite(n)) return ''
  return n.toFixed(2).replace(/\.?0+$/, '') === n.toFixed(2)
    ? n.toFixed(2)
    : n.toFixed(2)
}

function formatCount(n: number): string {
  return n > 0 ? Math.round(n).toString() : ''
}

function formatRatio(numerator: number, denominator: number): string {
  if (!denominator) return ''
  const pct = Math.round((numerator / denominator) * 100)
  return pct > 0 ? `${pct}%` : ''
}

function formatEff(n: number): string {
  if (!n || !Number.isFinite(n)) return ''
  return Number(n.toFixed(1)).toString()
}

// ── core derivation for one planDate ─────────────────────────────────────────

function recomputeForPlanDate(
  cells: Record<string, string>,
  planDate: string,
): Record<string, string> {
  const p = (suffix: string) => `${planDate}:${suffix}`
  const next = { ...cells }

  // 1. Per-process hours = count × (end - start)
  const hours: number[] = []
  const counts: number[] = []
  for (let i = 0; i < PROCESS_COUNT; i++) {
    const count = next[p(`s4-${i}-count`)] ?? ''
    const start = next[p(`s4-${i}-start`)] ?? ''
    const end = next[p(`s4-${i}-end`)] ?? ''
    const h = parseFloat(computeOperatorExpectedHours(count, start, end)) || 0
    const c = Math.round(parseFloat(count) || 0)
    next[p(`s4-${i}-hours`)] = formatHours(h)
    hours.push(h)
    counts.push(c)
  }

  // 2. Section 4 totals
  const totalHours = hours.reduce((s, h) => s + h, 0)
  const totalCount = counts.reduce((s, c) => s + c, 0)
  next[p('s4-total-hours')] = formatHours(totalHours)
  next[p('s4-total-count')] = formatCount(totalCount)

  // 3. Section 3B: mirrors Section 4 + computes ratios
  for (let i = 0; i < PROCESS_COUNT; i++) {
    next[p(`s3b-${i}-hours`)] = formatHours(hours[i]!)
    next[p(`s3b-${i}-count`)] = formatCount(counts[i]!)
    next[p(`s3b-${i}-ratio`)] = formatRatio(hours[i]!, totalHours)
    // mirror into s4 hratio column
    next[p(`s4-${i}-hratio`)] = formatRatio(hours[i]!, totalHours)
  }
  next[p('s3b-total-hours')] = formatHours(totalHours)
  next[p('s3b-total-count')] = formatCount(totalCount)
  next[p('s3b-total-ratio')] = totalHours > 0 ? '100%' : ''

  // 4. Section 3A: direct = forklift+coarse+fine; indirect = frontdesk
  const directHours = DIRECT_PROCESS_INDICES.reduce((s, i) => s + (hours[i] ?? 0), 0)
  const indirectHours = INDIRECT_PROCESS_INDICES.reduce((s, i) => s + (hours[i] ?? 0), 0)
  next[p('s3a-direct-hours')] = formatHours(directHours)
  next[p('s3a-indirect-hours')] = formatHours(indirectHours)
  next[p('s3a-direct-ratio')] = formatRatio(directHours, totalHours)
  next[p('s3a-indirect-ratio')] = formatRatio(indirectHours, totalHours)

  // 5. Section 1 totals derived from Section 4
  next[p('s1-hours')] = formatHours(totalHours)
  next[p('s1-count')] = formatCount(totalCount)

  // 6. Section 1 总效率 = 入站件量 / 总工时
  const inbound = parseFloat(next[p('s1-inbound')] ?? '') || 0
  next[p('s1-total-eff')] = inbound > 0 && totalHours > 0
    ? formatEff(inbound / totalHours)
    : ''

  return next
}

// ── public API ────────────────────────────────────────────────────────────────

export function applyAttendanceSchedulingPlanCellChange(
  prev: Record<string, string>,
  key: string,
  text: string,
): Record<string, string> {
  let next = { ...prev, [key]: text }

  // s4-total-count 直接编辑：只传播，不触发整体重算（整体重算会用各工序 count 之和覆盖用户值）
  const s4TotalMatch = key.match(S4_TOTAL_COUNT_KEY)
  if (s4TotalMatch) {
    const planDate = s4TotalMatch[1]!
    const p = (s: string) => `${planDate}:${s}`
    return { ...next, [p('s3b-total-count')]: text, [p('s1-count')]: text }
  }

  // s2 efficiency rate
  const s2Match = key.match(S2_EFFICIENCY_KEY)
  if (s2Match) {
    const prefix = s2Match[1]!
    const idx = s2Match[2]!
    const field = s2Match[3]!
    const target = field === 'target' ? text : (next[`${prefix}:s2-${idx}-target`] ?? '')
    const actual = field === 'actual' ? text : (next[`${prefix}:s2-${idx}-actual`] ?? '')
    next = { ...next, [`${prefix}:s2-${idx}-rate`]: computeEfficiencyAchievementRatio(target, actual) }
  }

  // Recompute all derived values for this planDate
  const planDateMatch = key.match(/^(\d{4}-\d{2}-\d{2}):/)
  if (planDateMatch) {
    next = recomputeForPlanDate(next, planDateMatch[1]!)
  }

  return next
}

export function recalculateEfficiencyAchievementRatios(
  cellTexts: Record<string, string>,
): Record<string, string> {
  // Recalc s2 efficiency ratios
  let next = { ...cellTexts }
  const seen = new Set<string>()
  for (const key of Object.keys(cellTexts)) {
    const m = key.match(/^(.+):s2-(\d+)-(target|actual|rate)$/)
    if (!m) continue
    const rowId = `${m[1]}:s2-${m[2]}`
    if (seen.has(rowId)) continue
    seen.add(rowId)
    const target = next[`${rowId}-target`] ?? ''
    const actual = next[`${rowId}-actual`] ?? ''
    next[`${rowId}-rate`] = computeEfficiencyAchievementRatio(target, actual)
  }

  // Recalc all s4-derived values (find unique planDates)
  const planDates = new Set<string>()
  for (const key of Object.keys(cellTexts)) {
    const m = key.match(/^(\d{4}-\d{2}-\d{2}):s4-\d+-count$/)
    if (m) planDates.add(m[1]!)
  }
  for (const planDate of planDates) {
    next = recomputeForPlanDate(next, planDate)
  }

  return next
}
