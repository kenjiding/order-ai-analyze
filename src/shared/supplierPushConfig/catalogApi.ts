import { backendFetch } from '../../api/httpClient'
import type { SupplierMentionContact, SupplierPushConfig, SupplierPushConfigDraft } from './types'

/** 导入用一条待写入的供应商：regionCode 由服务端按当前账号所属州决定，不从导入文件读取 */
type SupplierPushConfigImportRow = SupplierPushConfigDraft & { id: string }

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T; meta?: { imported: number; skipped: number } } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    type Wire = { ok?: boolean; data?: T; error?: string; meta?: { imported: number; skipped: number } }
    const json = (await res.json()) as Wire
    if (json.ok === true) {
      return {
        ok: true,
        data: json.data as T,
        meta: json.meta,
      }
    }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '请求失败' }
  } catch {
    return { ok: false, error: `无法访问后端 (${path})` }
  }
}

type ServerRow = {
  id: string
  vendorCode: string
  vendorName: string
  supplierNickname: string
  routeCode: string
  routeCodeWhitelist: string
  stationCode: string
  webhookUrl: string
  signingSecret: string | null
  pushDescription: string | null
  pushContent: string
  mentionOpenIds?: SupplierMentionContact[]
  regionCode: string
}

function toClient(row: ServerRow): SupplierPushConfig {
  return {
    id: row.id,
    vendorCode: row.vendorCode,
    vendorName: row.vendorName,
    supplierNickname: row.supplierNickname,
    routeCode: row.routeCode,
    routeCodeWhitelist: row.routeCodeWhitelist ?? '',
    stationCode: row.stationCode ?? '',
    webhookUrl: row.webhookUrl,
    signingSecret: row.signingSecret ?? undefined,
    pushDescription: row.pushDescription,
    pushContent: row.pushContent,
    mentionOpenIds: row.mentionOpenIds ?? [],
    regionCode: row.regionCode,
  }
}

export async function loadSupplierPushCatalog(): Promise<
  { ok: true; data: SupplierPushConfig[] } | { ok: false; error: string }
> {
  const res = await apiFetch<ServerRow[]>('/api/fleet-supplier-push/configs')
  if (!res.ok) return res
  return { ok: true, data: res.data.map(toClient) }
}

export async function createSupplierPushConfig(
  draft: SupplierPushConfigDraft,
): Promise<{ ok: true; data: SupplierPushConfig } | { ok: false; error: string }> {
  const res = await apiFetch<ServerRow>('/api/fleet-supplier-push/configs', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
  if (!res.ok) return res
  return { ok: true, data: toClient(res.data) }
}

export async function updateSupplierPushConfig(
  id: string,
  draft: SupplierPushConfigDraft,
): Promise<{ ok: true; data: SupplierPushConfig } | { ok: false; error: string }> {
  const res = await apiFetch<ServerRow>(`/api/fleet-supplier-push/configs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(draft),
  })
  if (!res.ok) return res
  return { ok: true, data: toClient(res.data) }
}

export async function deleteSupplierPushConfig(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return apiFetch<undefined>(`/api/fleet-supplier-push/configs/${id}`, { method: 'DELETE' })
}

export async function importSupplierPushCatalog(
  mode: 'merge' | 'replace',
  suppliers: SupplierPushConfigImportRow[],
): Promise<
  | { ok: true; data: SupplierPushConfig[]; imported: number; skipped: number }
  | { ok: false; error: string }
> {
  const res = await apiFetch<ServerRow[]>('/api/fleet-supplier-push/configs/import', {
    method: 'POST',
    body: JSON.stringify({ mode, suppliers }),
  })
  if (!res.ok) return res
  const imported = res.meta?.imported ?? suppliers.length
  const skipped = res.meta?.skipped ?? 0
  return { ok: true, data: res.data.map(toClient), imported, skipped }
}
