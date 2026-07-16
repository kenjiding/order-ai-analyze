import { backendFetch } from '../../api/httpClient'
import type {
  ChaseDispatchSchedule,
  ChaseDispatchScheduleDraft,
} from './chaseDispatchTypes'

async function apiFetch<T>(
  path: string,
  options?: RequestInit & { signal?: AbortSignal },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    type Wire = { ok?: boolean; data?: T; error?: string }
    const json = (await res.json()) as Wire
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '请求失败' }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    return { ok: false, error: `无法访问后端 (${path})` }
  }
}

export async function loadChaseDispatchSchedules(): Promise<
  { ok: true; data: ChaseDispatchSchedule[] } | { ok: false; error: string }
> {
  return apiFetch<ChaseDispatchSchedule[]>('/api/chase-dispatch/schedules', { method: 'GET' })
}

function withImileTokenHeaders(imileToken: string): HeadersInit {
  return imileToken
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` }
    : { 'Content-Type': 'application/json' }
}

export async function createChaseDispatchSchedule(
  draft: ChaseDispatchScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: ChaseDispatchSchedule } | { ok: false; error: string }> {
  return apiFetch<ChaseDispatchSchedule>('/api/chase-dispatch/schedules', {
    method: 'POST',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: withImileTokenHeaders(imileToken),
  })
}

export async function updateChaseDispatchSchedule(
  id: string,
  draft: ChaseDispatchScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: ChaseDispatchSchedule } | { ok: false; error: string }> {
  return apiFetch<ChaseDispatchSchedule>(`/api/chase-dispatch/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: withImileTokenHeaders(imileToken),
  })
}

export async function deleteChaseDispatchSchedule(
  id: string,
): Promise<{ ok: true; data: null } | { ok: false; error: string }> {
  return apiFetch<null>(`/api/chase-dispatch/schedules/${id}`, { method: 'DELETE' })
}

export type ChaseDispatchPushNowResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
}

/** 立刻推送：使用该条目已保存配置，不校验推送时间 */
export async function triggerChaseDispatchSchedulePushNow(
  id: string,
): Promise<{ ok: true; data: ChaseDispatchPushNowResult } | { ok: false; error: string }> {
  return apiFetch<ChaseDispatchPushNowResult>(`/api/chase-dispatch/schedules/${id}/push-now`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
