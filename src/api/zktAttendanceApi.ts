import type { ZktAttendanceSettings } from '../imile/zktAttendanceSettings'
import { toZktAttendanceInput } from '../imile/zktAttendanceSettings'
import type { ZktDepartmentNode } from '../imile/zktDepartmentTree'
import { backendFetch } from './httpClient'

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

export type FetchZktAttendanceResult = {
  /** 与 ZKT 接口 res.data 一致 */
  data: unknown[]
  /** 与 ZKT 接口 res.count 一致 */
  count: number
  records: unknown[]
  raw: unknown
  meta: {
    startDate: string
    endDate: string
    totalCount: number
    fetched: number
    pageCount: number
    query?: {
      start_date: string
      end_date: string
      departments: string
      areas: string
      groups: string
      employees: string
      page_size: number
    }
  }
}

export async function fetchZktDepartments(payload: {
  username: string
  password: string
}): Promise<ZktDepartmentNode[]> {
  const res = await backendFetch('/api/scanner-efficiency/zkt-departments', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  const parsed = JSON.parse(text) as { departments?: ZktDepartmentNode[] }
  return Array.isArray(parsed.departments) ? parsed.departments : []
}

export async function fetchZktAttendance(payload: {
  zktAttendance: ZktAttendanceSettings
  startDate: string
  endDate: string
}): Promise<FetchZktAttendanceResult> {
  const res = await backendFetch('/api/scanner-efficiency/zkt-attendance', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ...toZktAttendanceInput(payload.zktAttendance),
      startDate: payload.startDate,
      endDate: payload.endDate,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  const parsed = JSON.parse(text) as FetchZktAttendanceResult
  return {
    ...parsed,
    data: parsed.data ?? parsed.records ?? [],
    count: parsed.count ?? parsed.meta?.totalCount ?? 0,
  }
}
