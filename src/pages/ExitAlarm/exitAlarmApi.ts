import { backendFetch } from '../../api/httpClient'
import type {
  ExitAlarmSchedule,
  ExitAlarmScheduleDraft,
  WaybillSearchItem,
} from './exitAlarmTypes'

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
export async function loadExitAlarmSchedules(): Promise<
  { ok: true; data: ExitAlarmSchedule[] } | { ok: false; error: string }
> {
  return apiFetch<ExitAlarmSchedule[]>('/api/exit-alarm/schedules', { method: 'GET' })
}

function withImileTokenHeaders(imileToken: string): HeadersInit {
  return imileToken
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` }
    : { 'Content-Type': 'application/json' }
}

export async function createExitAlarmSchedule(
  draft: ExitAlarmScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: ExitAlarmSchedule } | { ok: false; error: string }> {
  return apiFetch<ExitAlarmSchedule>('/api/exit-alarm/schedules', {
    method: 'POST',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: withImileTokenHeaders(imileToken),
  })
}

export async function updateExitAlarmSchedule(
  id: string,
  draft: ExitAlarmScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: ExitAlarmSchedule } | { ok: false; error: string }> {
  return apiFetch<ExitAlarmSchedule>(`/api/exit-alarm/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...draft, imileToken }),
    headers: withImileTokenHeaders(imileToken),
  })
}

export async function deleteExitAlarmSchedule(
  id: string,
): Promise<{ ok: true; data: null } | { ok: false; error: string }> {
  return apiFetch<null>(`/api/exit-alarm/schedules/${id}`, { method: 'DELETE' })
}

export type ExitAlarmPushNowResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
  stationCode: string
  /** 本次统计的到件日列表（可多日合并） */
  dates: string[]
  /** 到件量过低：当天没开仓分拣，没有批次可推 */
  noBatch?: boolean
  /** 各供应商本次推送中未在阈值前出仓（未达标）的运单号，供导出 Excel */
  unqualifiedByVendor: {
    vendorName: string
    waybillNos: string[]
    /** 路由码白名单范围内未达标的运单号 */
    whitelistWaybillNos: string[]
  }[]
}

/** 立刻推送：使用该条目已保存配置，不校验推送时间 */
export async function triggerExitAlarmSchedulePushNow(
  id: string,
): Promise<{ ok: true; data: ExitAlarmPushNowResult } | { ok: false; error: string }> {
  return apiFetch<ExitAlarmPushNowResult>(`/api/exit-alarm/schedules/${id}/push-now`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

// 通过后端代理调用 iMile searchWaybill 接口
export async function searchExitAlarmWaybills(
  imileToken: string,
  params: {
    startTime: string
    endTime: string
    lastScanStationCode: string
  },
  signal?: AbortSignal,
): Promise<{ ok: true; data: WaybillSearchItem[] } | { ok: false; error: string }> {
  return apiFetch<WaybillSearchItem[]>('/api/exit-alarm/search-waybills', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${imileToken}`,
    },
    body: JSON.stringify(params),
    signal,
  })
}
