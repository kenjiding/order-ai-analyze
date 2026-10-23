import { backendFetch } from '../../api/httpClient'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const j = JSON.parse(text) as { error?: string }
    if (j.error) return j.error
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export type WeightStatItem = {
  waybillNo: string
  weight: number | null
  routeCode: string
  supplierKey: string
  supplierName: string
}

export type WeightStatResult = {
  stationCode: string
  startDate: string
  endDate: string
  dates: string[]
  items: WeightStatItem[]
}

function parseItems(value: unknown): WeightStatItem[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = asRecord(item) ?? {}
    const weight = typeof row.weight === 'number' && Number.isFinite(row.weight) ? row.weight : null
    return {
      waybillNo: String(row.waybillNo ?? ''),
      weight,
      routeCode: String(row.routeCode ?? ''),
      supplierKey: String(row.supplierKey ?? ''),
      supplierName: String(row.supplierName ?? ''),
    }
  })
}

export function parseWeightStatResult(raw: unknown): WeightStatResult {
  const root = asRecord(raw) ?? {}
  const nested = asRecord(root.data)
  const payload = nested ?? root
  return {
    stationCode: String(payload.stationCode ?? ''),
    startDate: String(payload.startDate ?? ''),
    endDate: String(payload.endDate ?? ''),
    dates: Array.isArray(payload.dates) ? payload.dates.map((d) => String(d)) : [],
    items: parseItems(payload.items),
  }
}

export async function fetchWeightStat(payload: {
  imileToken: string
  stationCode: string
  startDate: string
  endDate: string
}): Promise<WeightStatResult> {
  const res = await backendFetch('/api/weight-stat/query', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error(text || `HTTP ${res.status}`)
  }
  const envelope = asRecord(parsed)
  if (envelope && envelope.ok === false) {
    throw new Error(typeof envelope.error === 'string' ? envelope.error : '查询失败')
  }
  return parseWeightStatResult(parsed)
}

// ---- 客户端统计：区间命中数、整体均值/标准差 ----

export type WeightRange = {
  id: string
  min: number
  max: number
}

export type WeightRangeStat = WeightRange & {
  /** 实际命中件数 */
  count: number
}

export type WeightSummary = {
  total: number
  withWeight: number
  missingCount: number
  mean: number
  stdDev: number
}

export function computeWeightSummary(items: WeightStatItem[]): WeightSummary {
  const weights = items.map((i) => i.weight).filter((w): w is number => w != null)
  const total = items.length
  const withWeight = weights.length
  const missingCount = total - withWeight
  if (withWeight === 0) return { total, withWeight, missingCount, mean: 0, stdDev: 0 }
  const mean = weights.reduce((s, w) => s + w, 0) / withWeight
  const variance = weights.reduce((s, w) => s + (w - mean) ** 2, 0) / withWeight
  return { total, withWeight, missingCount, mean, stdDev: Math.sqrt(variance) }
}

export function buildRangeStats(items: WeightStatItem[], ranges: WeightRange[]): WeightRangeStat[] {
  const weights = items.map((i) => i.weight).filter((w): w is number => w != null)
  return ranges
    .slice()
    .sort((a, b) => a.min - b.min)
    .map((r) => {
      const count = weights.filter((w) => w >= r.min && w <= r.max).length
      return { ...r, count }
    })
}

// ---- 客户端统计：按供应商 / 路由码维度，统计各自在每个自定义重量区间的件数与占比 ----

export type WeightDimension = 'supplier' | 'route'

export type DimensionRangeCell = {
  rangeId: string
  min: number
  max: number
  /** 该维度分组下，重量落在 [min, max] 的件数 */
  count: number
  /** count / 该分组总件数 * 100 */
  pct: number
}

export type DimensionRangeRow = {
  key: string
  label: string
  /** 该分组总件数（不限于落在区间内的） */
  total: number
  /** 与传入 ranges 顺序一致（已按 min 排序） */
  cells: DimensionRangeCell[]
}

const UNASSIGNED_KEY = '__unassigned__'

export function buildDimensionRangeStats(
  items: WeightStatItem[],
  dimension: WeightDimension,
  ranges: WeightRange[],
): DimensionRangeRow[] {
  const sortedRanges = ranges.slice().sort((a, b) => a.min - b.min)
  const groups = new Map<string, { label: string; items: WeightStatItem[] }>()
  for (const item of items) {
    const key = dimension === 'supplier' ? item.supplierKey || UNASSIGNED_KEY : item.routeCode || UNASSIGNED_KEY
    const label = dimension === 'supplier' ? item.supplierName : item.routeCode
    const group = groups.get(key) ?? { label, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([key, { label, items: groupItems }]) => {
      const total = groupItems.length
      const cells = sortedRanges.map((r) => {
        const count = groupItems.filter((i) => i.weight != null && i.weight >= r.min && i.weight <= r.max).length
        return { rangeId: r.id, min: r.min, max: r.max, count, pct: total > 0 ? (count / total) * 100 : 0 }
      })
      return { key, label: key === UNASSIGNED_KEY ? '' : label, total, cells }
    })
    .sort((a, b) => b.total - a.total)
}
