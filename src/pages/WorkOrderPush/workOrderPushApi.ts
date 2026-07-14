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

export async function loadWorkOrderPushSchedule(): Promise<
  { ok: true; data: WorkOrderPushSchedule | null } | { ok: false; error: string }
> {
  return apiFetch<WorkOrderPushSchedule | null>('/api/work-order-push/schedule', { method: 'GET' })
}

export async function saveWorkOrderPushSchedule(
  draft: WorkOrderPushScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: WorkOrderPushSchedule } | { ok: false; error: string }> {
  return apiFetch<WorkOrderPushSchedule>('/api/work-order-push/schedule', {
    method: 'PUT',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: imileToken
      ? {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${imileToken}`,
        }
      : { 'Content-Type': 'application/json' },
  })
}

// 立即触发一次工单推送（测试用）
export type WorkOrderPushNowResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
}

export async function triggerWorkOrderPushNow(
  imileToken: string,
  params: { configIds: string[] },
  signal?: AbortSignal,
): Promise<{ ok: true; data: WorkOrderPushNowResult } | { ok: false; error: string }> {
  return apiFetch<WorkOrderPushNowResult>('/api/work-order-push/push-now', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${imileToken}`,
    },
    body: JSON.stringify(params),
    signal,
  })
}
