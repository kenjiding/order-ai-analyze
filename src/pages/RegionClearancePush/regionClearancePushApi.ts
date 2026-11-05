import { backendFetch } from '../../api/httpClient'
import type {
  RegionClearancePushSchedule,
  RegionClearancePushScheduleDraft,
  RegionOption,
} from './regionClearancePushTypes'

async function apiFetch<T>(
  path: string,
  options?: RequestInit & { signal?: AbortSignal },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(path, { headers: { 'Content-Type': 'application/json' }, ...options })
    type Wire = { ok?: boolean; data?: T; error?: string }
    const json = (await res.json()) as Wire
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '请求失败' }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    return { ok: false, error: `无法访问后端 (${path})` }
  }
}

export async function loadRegionOptions(): Promise<{ ok: true; data: RegionOption[] } | { ok: false; error: string }> {
  return apiFetch<RegionOption[]>('/api/region-clearance-push/regions', { method: 'GET' })
}

export async function loadRegionClearancePushSchedules(): Promise<
  { ok: true; data: RegionClearancePushSchedule[] } | { ok: false; error: string }
> {
  return apiFetch<RegionClearancePushSchedule[]>('/api/region-clearance-push/schedules', { method: 'GET' })
}

function withImileTokenHeaders(imileToken: string): HeadersInit {
  return imileToken
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` }
    : { 'Content-Type': 'application/json' }
}

export async function createRegionClearancePushSchedule(
  draft: RegionClearancePushScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: RegionClearancePushSchedule } | { ok: false; error: string }> {
  return apiFetch<RegionClearancePushSchedule>('/api/region-clearance-push/schedules', {
    method: 'POST',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: withImileTokenHeaders(imileToken),
  })
}

export async function updateRegionClearancePushSchedule(
  id: string,
  draft: RegionClearancePushScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: RegionClearancePushSchedule } | { ok: false; error: string }> {
  return apiFetch<RegionClearancePushSchedule>(`/api/region-clearance-push/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: withImileTokenHeaders(imileToken),
  })
}

export async function deleteRegionClearancePushSchedule(
  id: string,
): Promise<{ ok: true; data: null } | { ok: false; error: string }> {
  return apiFetch<null>(`/api/region-clearance-push/schedules/${id}`, { method: 'DELETE' })
}

/** 立即推送：使用该条目已保存配置，不校验推送时间 */
export async function triggerRegionClearancePushNow(
  id: string,
): Promise<{ ok: true; data: null } | { ok: false; error: string }> {
  return apiFetch<null>(`/api/region-clearance-push/schedules/${id}/push-now`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
