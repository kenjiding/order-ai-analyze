import { backendFetch } from '../../../../api/httpClient'
import type { DriverMapConfig, DriverMapPointsResponse, DriverMapRefreshResponse } from './driverMapTypes'

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
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
  } catch {
    return { ok: false, error: `无法访问后端 (${path})` }
  }
}

export function getDriverMapConfig() {
  return apiFetch<DriverMapConfig>('/api/driver-map/config')
}

export function getDriverMapPoints(params: { stationCode: string; dataDate: string; vendorCode?: string }) {
  const search = new URLSearchParams({ stationCode: params.stationCode, dataDate: params.dataDate })
  if (params.vendorCode) search.set('vendorCode', params.vendorCode)
  return apiFetch<DriverMapPointsResponse>(`/api/driver-map/points?${search.toString()}`)
}

export function triggerDriverMapRefresh(params: { stationCode: string; dataDate: string; vendorCode?: string }) {
  return apiFetch<DriverMapRefreshResponse>('/api/driver-map/refresh', {
    method: 'POST',
    body: JSON.stringify({
      stationCode: params.stationCode,
      dataDate: params.dataDate,
      vendorCode: params.vendorCode,
    }),
  })
}
