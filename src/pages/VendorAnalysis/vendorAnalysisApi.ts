import { getApiBaseUrl } from '../../utils/apiBaseUrl'
import type { LongTailOrderRow, StationOption, UnprocessedTicketsData, VendorOption, VendorPushConfig, VendorPushConfigDraft } from './vendorAnalysisTypes'

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
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
  } catch {
    return { ok: false, error: `无法访问后端 (${path})` }
  }
}

export async function fetchStations(
  imileToken: string,
): Promise<{ ok: true; data: StationOption[] } | { ok: false; error: string }> {
  return apiFetch<StationOption[]>('/api/vendor-analysis/stations', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` },
  })
}

export async function fetchVendors(
  imileToken: string,
): Promise<{ ok: true; data: VendorOption[] } | { ok: false; error: string }> {
  return apiFetch<VendorOption[]>('/api/vendor-analysis/vendors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` },
    body: JSON.stringify({}),
  })
}

export async function fetchComplaintTickets(
  imileToken: string,
  params: { startTime: string; endTime: string },
): Promise<{ ok: true; data: unknown[] } | { ok: false; error: string }> {
  return apiFetch<unknown[]>('/api/vendor-analysis/complaint-tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` },
    body: JSON.stringify(params),
  })
}

export async function fetchUnprocessedTickets(
  imileToken: string,
  params: { startTime: string; endTime: string },
): Promise<{ ok: true; data: UnprocessedTicketsData } | { ok: false; error: string }> {
  return apiFetch<UnprocessedTicketsData>('/api/vendor-analysis/unprocessed-tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` },
    body: JSON.stringify(params),
  })
}

export async function fetchLongTailOrders(
  imileToken: string,
  params: { stationCodes: string[] },
): Promise<{ ok: true; data: LongTailOrderRow[] } | { ok: false; error: string }> {
  return apiFetch<LongTailOrderRow[]>('/api/vendor-analysis/long-tail-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` },
    body: JSON.stringify(params),
  })
}

export async function fetchWaybills(
  imileToken: string,
  params: { startTime: string; endTime: string },
): Promise<{ ok: true; data: unknown[] } | { ok: false; error: string }> {
  return apiFetch<unknown[]>('/api/vendor-analysis/waybills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` },
    body: JSON.stringify(params),
  })
}

export async function loadConfigs(): Promise<
  { ok: true; data: VendorPushConfig[] } | { ok: false; error: string }
> {
  return apiFetch<VendorPushConfig[]>('/api/vendor-analysis/configs', { method: 'GET' })
}

export async function createConfig(
  draft: VendorPushConfigDraft,
): Promise<{ ok: true; data: VendorPushConfig } | { ok: false; error: string }> {
  return apiFetch<VendorPushConfig>('/api/vendor-analysis/configs', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
}

export async function updateConfig(
  id: string,
  draft: VendorPushConfigDraft,
): Promise<{ ok: true; data: VendorPushConfig } | { ok: false; error: string }> {
  return apiFetch<VendorPushConfig>(`/api/vendor-analysis/configs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(draft),
  })
}

export async function deleteConfig(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return apiFetch<undefined>(`/api/vendor-analysis/configs/${id}`, { method: 'DELETE' })
}
