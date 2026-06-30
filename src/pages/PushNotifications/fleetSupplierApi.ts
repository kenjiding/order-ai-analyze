import { getApiBaseUrl } from '../../utils/apiBaseUrl'
import type { FleetSupplierConfig } from './fleetSupplierPushTypes'

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

type ServerRow = {
  id: string
  supplierName: string
  routeCode: string
  webhookUrl: string
  signingSecret: string | null
  pushContent: string
}

function toClient(row: ServerRow): FleetSupplierConfig {
  return {
    id: row.id,
    supplierName: row.supplierName,
    routeCode: row.routeCode,
    webhookUrl: row.webhookUrl,
    signingSecret: row.signingSecret ?? undefined,
    pushContent: row.pushContent,
  }
}

export async function apiLoadFleetSuppliers(): Promise<
  { ok: true; data: FleetSupplierConfig[] } | { ok: false; error: string }
> {
  const res = await apiFetch<ServerRow[]>('/api/fleet-supplier-push/configs')
  if (!res.ok) return res
  return { ok: true, data: res.data.map(toClient) }
}

export async function apiCreateFleetSupplier(
  draft: Omit<FleetSupplierConfig, 'id'>,
): Promise<{ ok: true; data: FleetSupplierConfig } | { ok: false; error: string }> {
  const res = await apiFetch<ServerRow>('/api/fleet-supplier-push/configs', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
  if (!res.ok) return res
  return { ok: true, data: toClient(res.data) }
}

export async function apiUpdateFleetSupplier(
  id: string,
  draft: Omit<FleetSupplierConfig, 'id'>,
): Promise<{ ok: true; data: FleetSupplierConfig } | { ok: false; error: string }> {
  const res = await apiFetch<ServerRow>(`/api/fleet-supplier-push/configs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(draft),
  })
  if (!res.ok) return res
  return { ok: true, data: toClient(res.data) }
}

export async function apiDeleteFleetSupplier(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return apiFetch<undefined>(`/api/fleet-supplier-push/configs/${id}`, { method: 'DELETE' })
}

export async function apiImportFleetSuppliers(
  mode: 'merge' | 'replace',
  suppliers: FleetSupplierConfig[],
): Promise<{ ok: true; data: FleetSupplierConfig[] } | { ok: false; error: string }> {
  const res = await apiFetch<ServerRow[]>('/api/fleet-supplier-push/configs/import', {
    method: 'POST',
    body: JSON.stringify({ mode, suppliers }),
  })
  if (!res.ok) return res
  return { ok: true, data: res.data.map(toClient) }
}
