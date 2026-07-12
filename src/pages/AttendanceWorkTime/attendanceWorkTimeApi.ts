import { getApiBaseUrl } from '../../utils/apiBaseUrl'
import type { AttendanceWorkRecord, AttendanceWorkRecordDraft, AttendanceWorkerSuggestion } from './attendanceWorkTimeTypes'

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    type Wire = { ok?: boolean; data?: T; error?: string }
    const json = (await res.json()) as Wire
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '请求失败' }
  } catch {
    return { ok: false, error: `无法访问后端 (${path})` }
  }
}

export async function fetchAttendanceWorkRecords(params: {
  regionCode?: string | null
  startDate?: string | null
  endDate?: string | null
}): Promise<ApiResult<AttendanceWorkRecord[]>> {
  const query = new URLSearchParams()
  if (params.regionCode) query.set('region', params.regionCode)
  if (params.startDate) query.set('startDate', params.startDate)
  if (params.endDate) query.set('endDate', params.endDate)
  const qs = query.toString()
  return apiFetch<AttendanceWorkRecord[]>(`/api/attendance-work-time/records${qs ? `?${qs}` : ''}`)
}

export async function createAttendanceWorkRecord(
  draft: AttendanceWorkRecordDraft,
): Promise<ApiResult<AttendanceWorkRecord>> {
  return apiFetch<AttendanceWorkRecord>('/api/attendance-work-time/records', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
}

export async function updateAttendanceWorkRecord(
  id: string,
  draft: AttendanceWorkRecordDraft,
): Promise<ApiResult<AttendanceWorkRecord>> {
  return apiFetch<AttendanceWorkRecord>(`/api/attendance-work-time/records/${id}`, {
    method: 'PUT',
    body: JSON.stringify(draft),
  })
}

export async function deleteAttendanceWorkRecord(id: string): Promise<ApiResult<null>> {
  return apiFetch<null>(`/api/attendance-work-time/records/${id}`, { method: 'DELETE' })
}

export async function searchAttendanceWorkers(
  query: string,
  regionCode?: string | null,
): Promise<ApiResult<AttendanceWorkerSuggestion[]>> {
  const params = new URLSearchParams({ q: query })
  if (regionCode) params.set('region', regionCode)
  return apiFetch<AttendanceWorkerSuggestion[]>(`/api/attendance-work-time/workers/suggest?${params.toString()}`)
}
