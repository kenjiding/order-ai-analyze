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

/** 当天 24h + 次日 0–11 点（最后一桶含 11:00 整点），与后端 HOUR_SLOT_COUNT 对齐 */
export const HOUR_SLOT_COUNT = 35
/** 对照表：次日 07:00–11:00（index = 24+hour；10:00 桶含 11:00 整点） */
export const MATRIX_NEXT_DAY_HOURS = [7, 8, 9, 10] as const

export function nextDayHourSlotIndex(hour: number): number {
  return 24 + hour
}

export function matrixNextDayHoursAllZero(row: ExitRateDimRow): boolean {
  return MATRIX_NEXT_DAY_HOURS.every((hour) => (row.byHour[nextDayHourSlotIndex(hour)] ?? 0) === 0)
}

export type ExitRateDimRow = {
  key: string
  name: string
  total: number
  sameDay: number
  nextMorning: number
  pending: number
  byHour: number[]
}

export type ExitRateSlice = {
  total: number
  sameDay: number
  nextMorning: number
  pending: number
  byHour: number[]
  vendors: ExitRateDimRow[]
  routes: ExitRateDimRow[]
  drivers: ExitRateDimRow[]
}

export type ExitRateQueryResult = ExitRateSlice & {
  stationCode: string
  startDate: string
  endDate: string
  dates: string[]
  byDate: Record<string, ExitRateSlice>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asDimRows(value: unknown): ExitRateDimRow[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = asRecord(item) ?? {}
    return {
      key: String(row.key ?? ''),
      name: String(row.name ?? ''),
      total: Number(row.total) || 0,
      sameDay: Number(row.sameDay) || 0,
      nextMorning: Number(row.nextMorning) || 0,
      pending: Number(row.pending) || 0,
      byHour: Array.isArray(row.byHour) ? row.byHour.map((n) => Number(n) || 0) : [],
    }
  })
}

function parseSlice(payload: Record<string, unknown>): ExitRateSlice {
  return {
    total: Number(payload.total) || 0,
    sameDay: Number(payload.sameDay) || 0,
    nextMorning: Number(payload.nextMorning) || 0,
    pending: Number(payload.pending) || 0,
    byHour: Array.isArray(payload.byHour) ? payload.byHour.map((n) => Number(n) || 0) : [],
    vendors: asDimRows(payload.vendors),
    routes: asDimRows(payload.routes),
    drivers: asDimRows(payload.drivers),
  }
}

function parseByDate(value: unknown): Record<string, ExitRateSlice> {
  const record = asRecord(value)
  if (!record) return {}
  const out: Record<string, ExitRateSlice> = {}
  for (const [date, slice] of Object.entries(record)) {
    const row = asRecord(slice)
    if (!row) continue
    out[date] = parseSlice(row)
  }
  return out
}

export function parseExitRateQueryResult(raw: unknown): ExitRateQueryResult {
  const root = asRecord(raw) ?? {}
  const nested = asRecord(root.data)
  const payload = nested && (Array.isArray(nested.vendors) || nested.total != null) ? nested : root
  return {
    ...parseSlice(payload),
    stationCode: String(payload.stationCode ?? ''),
    startDate: String(payload.startDate ?? ''),
    endDate: String(payload.endDate ?? ''),
    dates: Array.isArray(payload.dates) ? payload.dates.map((d) => String(d)) : [],
    byDate: parseByDate(payload.byDate),
  }
}

export async function fetchExitRateQuery(payload: {
  imileToken: string
  stationCode: string
  startDate: string
  endDate: string
}): Promise<ExitRateQueryResult> {
  const res = await backendFetch('/api/exit-rate-query/query', {
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
  return parseExitRateQueryResult(parsed)
}

export function ratePct(met: number, total: number): number | null {
  if (total <= 0) return null
  return (met / total) * 100
}

export function formatPct(rate: number | null): string {
  return rate == null ? '—' : `${rate.toFixed(1)}%`
}
