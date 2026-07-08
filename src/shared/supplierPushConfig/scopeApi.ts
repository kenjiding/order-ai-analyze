import { getApiBaseUrl } from '../../utils/apiBaseUrl'
import type { SupplierConfigScopeKey } from './types'

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

type ScopeIdsWire = { scopeKey: SupplierConfigScopeKey; enabledIds: string[] }

export async function loadScopeEnabledIds(scopeKey: SupplierConfigScopeKey) {
  return apiFetch<ScopeIdsWire>(`/api/supplier-config-scopes/${scopeKey}/enabled-ids`)
}

export async function saveScopeEnabledIds(scopeKey: SupplierConfigScopeKey, enabledIds: string[]) {
  return apiFetch<ScopeIdsWire>(`/api/supplier-config-scopes/${scopeKey}/enabled-ids`, {
    method: 'PUT',
    body: JSON.stringify({ enabledIds }),
  })
}
