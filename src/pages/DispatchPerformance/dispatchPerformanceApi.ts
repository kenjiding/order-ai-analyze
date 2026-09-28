import { backendFetch } from '../../api/httpClient'
import type { PublicJob } from '../../api/jobsClient'
import type {
  DispatchPerformanceConfig,
  DispatchPerformanceConfigDraft,
  DispatchPerformanceException,
  DispatchPerformanceExceptionDraft,
  DispatchPerformanceResult,
  DispatchProfitDailyRow,
  WhitelistMode,
} from './dispatchPerformanceTypes'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const
const BASE = '/api/dispatch-performance'

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const json = JSON.parse(text) as { error?: string }
    if (json.error) return json.error
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await backendFetch(`${BASE}${path}`, { headers: JSON_HEADERS, ...init })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return (text ? JSON.parse(text) : null) as T
}

// ── 站点配置 ──────────────────────────────────────────────────────

export async function fetchDispatchPerformanceConfigs(
  signal?: AbortSignal,
): Promise<DispatchPerformanceConfig[]> {
  const json = await request<{ configs: DispatchPerformanceConfig[] }>('/configs', {
    method: 'GET',
    signal,
  })
  return json.configs
}

export async function createDispatchPerformanceConfig(
  draft: DispatchPerformanceConfigDraft,
): Promise<DispatchPerformanceConfig> {
  return request<DispatchPerformanceConfig>('/configs', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
}

export async function updateDispatchPerformanceConfig(
  id: string,
  draft: Partial<DispatchPerformanceConfigDraft>,
): Promise<DispatchPerformanceConfig> {
  return request<DispatchPerformanceConfig>(`/configs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(draft),
  })
}

export async function deleteDispatchPerformanceConfig(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/configs/${id}`, { method: 'DELETE' })
}

// ── 单站点数据 ────────────────────────────────────────────────────

export type DispatchPerformanceDataQuery = {
  configId: string
  startDate: string
  endDate: string
  supplierKeys?: string[]
  whitelistMode: WhitelistMode
}

export async function fetchDispatchPerformanceData(
  query: DispatchPerformanceDataQuery,
  signal?: AbortSignal,
): Promise<DispatchPerformanceResult> {
  const params = new URLSearchParams({ startDate: query.startDate, endDate: query.endDate })
  if (query.supplierKeys?.length) params.set('supplierKey', query.supplierKeys.join(','))
  if (query.whitelistMode === 'include') params.set('whitelist', 'include')
  return request<DispatchPerformanceResult>(`/configs/${query.configId}/data?${params}`, {
    method: 'GET',
    signal,
  })
}

// ── 司机利润趋势 ──────────────────────────────────────────────────

export async function fetchDispatchProfitTrend(
  query: DispatchPerformanceDataQuery,
  signal?: AbortSignal,
): Promise<DispatchProfitDailyRow[]> {
  const params = new URLSearchParams({ startDate: query.startDate, endDate: query.endDate })
  if (query.supplierKeys?.length) params.set('supplierKey', query.supplierKeys.join(','))
  if (query.whitelistMode === 'include') params.set('whitelist', 'include')
  const json = await request<{ rows: DispatchProfitDailyRow[] }>(
    `/configs/${query.configId}/profit-trend?${params}`,
    { method: 'GET', signal },
  )
  return json.rows
}

// ── 立刻统计 ──────────────────────────────────────────────────────

/**
 * 触发一次手动结算。走作业队列（worker 独占执行），立即返回 jobId 供轮询。
 * 同一站点已有排队/执行中的任务时复用，`reused` 为 true。
 */
export async function postSettleNow(
  configId: string,
): Promise<{ job: PublicJob; reused: boolean }> {
  return request<{ job: PublicJob; reused: boolean }>(`/configs/${configId}/settle-now`, {
    method: 'POST',
  })
}

// ── 派签异常报备 ──────────────────────────────────────────────────

export async function createDispatchPerformanceException(
  configId: string,
  draft: DispatchPerformanceExceptionDraft,
): Promise<DispatchPerformanceException> {
  return request<DispatchPerformanceException>(`/configs/${configId}/exceptions`, {
    method: 'POST',
    body: JSON.stringify(draft),
  })
}

export async function fetchDispatchPerformanceExceptions(
  configId: string,
  query: {
    startDate: string
    endDate: string
    supplierKey?: string
    routeCode?: string
    courierCode?: string
  },
  signal?: AbortSignal,
): Promise<DispatchPerformanceException[]> {
  const params = new URLSearchParams({ startDate: query.startDate, endDate: query.endDate })
  if (query.supplierKey) params.set('supplierKey', query.supplierKey)
  if (query.routeCode) params.set('routeCode', query.routeCode)
  if (query.courierCode) params.set('courierCode', query.courierCode)
  const json = await request<{ exceptions: DispatchPerformanceException[] }>(
    `/configs/${configId}/exceptions?${params}`,
    { method: 'GET', signal },
  )
  return json.exceptions
}

export async function deleteDispatchPerformanceException(
  configId: string,
  exceptionId: string,
): Promise<void> {
  await request<{ ok: boolean }>(`/configs/${configId}/exceptions/${exceptionId}`, {
    method: 'DELETE',
  })
}
