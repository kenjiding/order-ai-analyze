import { backendFetch } from '../../api/httpClient'
import type { DispatchAlarmPushNowResult, DispatchAlarmSchedule, DispatchAlarmScheduleDraft } from './dispatchAlarmTypes'

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

// 定时推送配置
export async function loadDispatchAlarmSchedule(): Promise<
  { ok: true; data: DispatchAlarmSchedule | null } | { ok: false; error: string }
> {
  return apiFetch<DispatchAlarmSchedule | null>('/api/dispatch-alarm/schedule', { method: 'GET' })
}

export async function saveDispatchAlarmSchedule(
  draft: DispatchAlarmScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: DispatchAlarmSchedule } | { ok: false; error: string }> {
  return apiFetch<DispatchAlarmSchedule>('/api/dispatch-alarm/schedule', {
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

export async function saveDispatchAlarmScheduledPushConfigIds(
  pushConfigIds: string[],
): Promise<{ ok: true; data: DispatchAlarmSchedule } | { ok: false; error: string }> {
  return apiFetch<DispatchAlarmSchedule>('/api/dispatch-alarm/schedule/push-config-ids', {
    method: 'PUT',
    body: JSON.stringify({ pushConfigIds }),
  })
}

// 立即触发一次推送（测试用）
export async function triggerDispatchAlarmPushNow(
  imileToken: string,
  params: {
    stationCode: string
    date: string // "YYYY-MM-DD" 按当前账号州/区域
    configIds: string[]
    alertThresholdPct: number
  },
  signal?: AbortSignal,
): Promise<{ ok: true; data: DispatchAlarmPushNowResult } | { ok: false; error: string }> {
  return apiFetch<DispatchAlarmPushNowResult>('/api/dispatch-alarm/push-now', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${imileToken}`,
    },
    body: JSON.stringify(params),
    signal,
  })
}
