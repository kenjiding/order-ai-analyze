import { backendFetch } from '../../api/httpClient'
import { normalizeFleetClientCode } from './fleetSupplierAggregate'

/** 优先客户商家编码集合（已归一化），供「拉取入站数据」与「选择扫描文件」两种来源统一比对 */
export async function fetchPriorityClientCodes(): Promise<
  { ok: true; codes: Set<string> } | { ok: false; error: string }
> {
  try {
    const res = await backendFetch('/api/priority-clients/codes')
    const json = (await res.json()) as { ok?: boolean; data?: string[]; error?: string }
    if (json.ok === true && Array.isArray(json.data)) {
      return { ok: true, codes: new Set(json.data.map(normalizeFleetClientCode)) }
    }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '' }
  }
}
