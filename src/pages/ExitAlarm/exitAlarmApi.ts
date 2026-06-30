import { getApiBaseUrl } from '../../utils/apiBaseUrl'
import type { VendorPushEntry, VendorPushEntryDraft } from '../../components/VendorPushPanel/vendorPushTypes'
import type { ExitAlarmSchedule, ExitAlarmScheduleDraft, WaybillSearchItem } from './exitAlarmTypes'

async function apiFetch<T>(
  path: string,
  options?: RequestInit & { signal?: AbortSignal },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
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
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    return { ok: false, error: `无法访问后端 (${path})` }
  }
}

// 供应商推送配置 CRUD
export async function loadExitAlarmVendorConfigs(): Promise<
  { ok: true; data: VendorPushEntry[] } | { ok: false; error: string }
> {
  return apiFetch<VendorPushEntry[]>('/api/exit-alarm/vendor-configs', { method: 'GET' })
}

export async function createExitAlarmVendorConfig(
  draft: VendorPushEntryDraft,
): Promise<{ ok: true; data: VendorPushEntry } | { ok: false; error: string }> {
  return apiFetch<VendorPushEntry>('/api/exit-alarm/vendor-configs', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
}

export async function updateExitAlarmVendorConfig(
  id: string,
  draft: VendorPushEntryDraft,
): Promise<{ ok: true; data: VendorPushEntry } | { ok: false; error: string }> {
  return apiFetch<VendorPushEntry>(`/api/exit-alarm/vendor-configs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(draft),
  })
}

export async function deleteExitAlarmVendorConfig(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return apiFetch<undefined>(`/api/exit-alarm/vendor-configs/${id}`, { method: 'DELETE' })
}

// 定时推送配置
export async function loadExitAlarmSchedule(): Promise<
  { ok: true; data: ExitAlarmSchedule | null } | { ok: false; error: string }
> {
  return apiFetch<ExitAlarmSchedule | null>('/api/exit-alarm/schedule', { method: 'GET' })
}

export async function saveExitAlarmSchedule(
  draft: ExitAlarmScheduleDraft,
  imileToken: string,
): Promise<{ ok: true; data: ExitAlarmSchedule } | { ok: false; error: string }> {
  return apiFetch<ExitAlarmSchedule>('/api/exit-alarm/schedule', {
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

// 立即触发一次推送（测试用）
export type ExitAlarmPushNowResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
}

export async function triggerExitAlarmPushNow(
  imileToken: string,
  params: {
    stationCode: string
    pushTime: string // "HH:mm"
    date: string    // "YYYY-MM-DD" 阿德莱德时区
  },
  signal?: AbortSignal,
): Promise<{ ok: true; data: ExitAlarmPushNowResult } | { ok: false; error: string }> {
  return apiFetch<ExitAlarmPushNowResult>('/api/exit-alarm/push-now', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${imileToken}`,
    },
    body: JSON.stringify(params),
    signal,
  })
}
