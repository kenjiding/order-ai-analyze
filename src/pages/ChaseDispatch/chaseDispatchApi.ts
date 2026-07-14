import { backendFetch } from '../../api/httpClient'
import type {
  ChaseDispatchSchedule,
  ChaseDispatchScheduleDraft,
  StagnationBucket,
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

export async function loadChaseDispatchSchedule(): Promise<
  { ok: true; data: ChaseDispatchSchedule | null } | { ok: false; error: string }
> {
  return apiFetch<ChaseDispatchSchedule | null>('/api/chase-dispatch/schedule', { method: 'GET' })
}

export async function saveChaseDispatchSchedule(
  draft: ChaseDispatchScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: ChaseDispatchSchedule } | { ok: false; error: string }> {
  return apiFetch<ChaseDispatchSchedule>('/api/chase-dispatch/schedule', {
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

// 立即触发一次催派推送（测试用）
export type ChaseDispatchPushNowResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
}

export async function triggerChaseDispatchPushNow(
  imileToken: string,
  params: {
    stationCode: string
    stagnationBuckets: StagnationBucket[]
    configIds: string[]
  },
  signal?: AbortSignal,
): Promise<{ ok: true; data: ChaseDispatchPushNowResult } | { ok: false; error: string }> {
  return apiFetch<ChaseDispatchPushNowResult>('/api/chase-dispatch/push-now', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${imileToken}`,
    },
    body: JSON.stringify(params),
    signal,
  })
}
