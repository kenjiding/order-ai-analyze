import { backendFetch } from '../../api/httpClient'
import type { StationOption } from './vendorAnalysisTypes'

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

/** 独立拆出：全局站点选择器（AppLayout 里非懒加载）只需要这一个函数，
 * 不应牵连 vendorAnalysisApi.ts 里其它供应商分析专属代码打进全局预加载 chunk */
export async function fetchStations(
  imileToken: string,
): Promise<{ ok: true; data: StationOption[] } | { ok: false; error: string }> {
  return apiFetch<StationOption[]>('/api/vendor-analysis/stations', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` },
  })
}
