import { backendFetch } from '../../api/httpClient'
import type { WorkOrderPushSchedule, WorkOrderPushScheduleDraft } from './workOrderPushTypes'

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

export async function loadWorkOrderPushSchedules(): Promise<
  { ok: true; data: WorkOrderPushSchedule[] } | { ok: false; error: string }
> {
  return apiFetch<WorkOrderPushSchedule[]>('/api/work-order-push/schedules', { method: 'GET' })
}

function withImileTokenHeaders(imileToken: string): HeadersInit {
  return imileToken
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` }
    : { 'Content-Type': 'application/json' }
}

export async function createWorkOrderPushSchedule(
  draft: WorkOrderPushScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: WorkOrderPushSchedule } | { ok: false; error: string }> {
  return apiFetch<WorkOrderPushSchedule>('/api/work-order-push/schedules', {
    method: 'POST',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: withImileTokenHeaders(imileToken),
  })
}

export async function updateWorkOrderPushSchedule(
  id: string,
  draft: WorkOrderPushScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: WorkOrderPushSchedule } | { ok: false; error: string }> {
  return apiFetch<WorkOrderPushSchedule>(`/api/work-order-push/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: withImileTokenHeaders(imileToken),
  })
}

export async function deleteWorkOrderPushSchedule(
  id: string,
): Promise<{ ok: true; data: null } | { ok: false; error: string }> {
  return apiFetch<null>(`/api/work-order-push/schedules/${id}`, { method: 'DELETE' })
}

export type WorkOrderPushNowResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
}

/** 立刻推送：使用该条目已保存配置，不校验推送时间 */
export async function triggerWorkOrderPushSchedulePushNow(
  id: string,
): Promise<{ ok: true; data: WorkOrderPushNowResult } | { ok: false; error: string }> {
  return apiFetch<WorkOrderPushNowResult>(`/api/work-order-push/schedules/${id}/push-now`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
