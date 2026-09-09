import { backendFetch } from '../../api/httpClient'
import type { DispatchAlarmSchedule, DispatchAlarmScheduleDraft } from './dispatchAlarmTypes'

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
export async function loadDispatchAlarmSchedules(): Promise<
  { ok: true; data: DispatchAlarmSchedule[] } | { ok: false; error: string }
> {
  return apiFetch<DispatchAlarmSchedule[]>('/api/dispatch-alarm/schedules', { method: 'GET' })
}

function withImileTokenHeaders(imileToken: string): HeadersInit {
  return imileToken
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` }
    : { 'Content-Type': 'application/json' }
}

export async function createDispatchAlarmSchedule(
  draft: DispatchAlarmScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: DispatchAlarmSchedule } | { ok: false; error: string }> {
  return apiFetch<DispatchAlarmSchedule>('/api/dispatch-alarm/schedules', {
    method: 'POST',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: withImileTokenHeaders(imileToken),
  })
}

export async function updateDispatchAlarmSchedule(
  id: string,
  draft: DispatchAlarmScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: DispatchAlarmSchedule } | { ok: false; error: string }> {
  return apiFetch<DispatchAlarmSchedule>(`/api/dispatch-alarm/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: withImileTokenHeaders(imileToken),
  })
}

export async function deleteDispatchAlarmSchedule(
  id: string,
): Promise<{ ok: true; data: null } | { ok: false; error: string }> {
  return apiFetch<null>(`/api/dispatch-alarm/schedules/${id}`, { method: 'DELETE' })
}

export type DispatchAlarmPushNowResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
  stationCode: string
  /** 本次统计的到件日列表（可多日合并） */
  dates: string[]
  /** 到件量过低：当天没开仓分拣，没有批次可推 */
  noBatch?: boolean
}

/** 立刻推送：使用该条目已保存配置，不校验推送时间 */
export async function triggerDispatchAlarmSchedulePushNow(
  id: string,
): Promise<{ ok: true; data: DispatchAlarmPushNowResult } | { ok: false; error: string }> {
  return apiFetch<DispatchAlarmPushNowResult>(`/api/dispatch-alarm/schedules/${id}/push-now`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
