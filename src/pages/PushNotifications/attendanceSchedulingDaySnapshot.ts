import { SCHEDULING_PLAN_PROCESSES } from '../ScannerEfficiency/attendanceSchedulingPlanPreviewModel'

const KEY_PREFIX = 'scheduling-day-snapshot:'

// 粗分(idx=1)、细分(idx=2) 才回填"上一日件量"；叉车/前台不填
const QTY_FILL_INDICES = new Set([1, 2])

// ── 保存当天快照（Section 4 关键字段，stripped，不带 planDate: 前缀）──────────
export function saveDaySnapshot(planDate: string, strippedCells: Record<string, string>): void {
  const n = SCHEDULING_PLAN_PROCESSES.length
  const snap: Record<string, string> = {}

  for (let i = 0; i < n; i++) {
    for (const field of ['qty', 'hours', 'eff', 'count']) {
      const val = strippedCells[`s4-${i}-${field}`]
      if (val) snap[`s4-${i}-${field}`] = val
    }
  }
  for (const field of ['inbound', 'coarse', 'fine']) {
    const val = strippedCells[`s1-${field}`]
    if (val) snap[`s1-${field}`] = val
  }

  try {
    localStorage.setItem(`${KEY_PREFIX}${planDate}`, JSON.stringify(snap))
  } catch { /* ignore quota errors */ }
}

// ── 读取指定日期的快照 ────────────────────────────────────────────────────────
function loadDaySnapshot(planDate: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${planDate}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const snap: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string') snap[k] = v
    }
    return snap
  } catch {
    return null
  }
}

// ── 找 beforeDate 之前最近一次快照（处理周末/节假日不排班的情况）─────────────
export function loadMostRecentDaySnapshot(
  beforeDate: string,
): { date: string; cells: Record<string, string> } | null {
  try {
    const candidates: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(KEY_PREFIX)) continue
      const date = key.slice(KEY_PREFIX.length)
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < beforeDate) {
        candidates.push(date)
      }
    }
    if (candidates.length === 0) return null
    candidates.sort()
    const latestDate = candidates[candidates.length - 1]!
    const cells = loadDaySnapshot(latestDate)
    return cells ? { date: latestDate, cells } : null
  } catch {
    return null
  }
}

// ── 把快照映射成 Section 2 自动回填值（带 planDate: 前缀）───────────────────
// 上一日件量：仅粗分(1)、细分(2)
// 上一日投入工时 ← s4-{i}-hours（预计出勤工时）
// 目标人效 ← s4-{i}-eff（岗位效率）
// 实际人效、偏差、判断、原因说明、次日调整建议、调整岗位/时段 —— 不自动填，
//   用户已有内容通过 mergeCellTextsNonEmpty 保留
export function buildSection2AutoFill(
  planDate: string,
  snapshot: Record<string, string>,
): Record<string, string> {
  const n = SCHEDULING_PLAN_PROCESSES.length
  const out: Record<string, string> = {}
  const p = (s: string) => `${planDate}:${s}`

  for (let i = 0; i < n; i++) {
    const hours = snapshot[`s4-${i}-hours`] ?? ''
    const eff = snapshot[`s4-${i}-eff`] ?? ''

    if (QTY_FILL_INDICES.has(i)) {
      const qty = snapshot[`s4-${i}-qty`] ?? ''
      if (qty) out[p(`s2-${i}-qty`)] = qty
    }

    if (hours) out[p(`s2-${i}-workhours`)] = hours
    if (eff) out[p(`s2-${i}-target`)] = eff
  }

  return out
}
