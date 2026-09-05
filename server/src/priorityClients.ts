/**
 * 「优先客户配置」页面维护的商家编码集合 —— 即业务口径上的「本地件优先客户」。
 * 运单侧用 searchWaybill 的 clientCode 与之匹配，供 24H 派签告警 / 滞留告警统计优先件数量。
 * 编码统一大写后比较，避免两侧大小写不一致导致漏匹配。
 */
import { getDb, schema } from './db'

export function normalizeClientCode(code: unknown): string {
  return typeof code === 'string' ? code.trim().toUpperCase() : ''
}

export async function loadPriorityClientCodes(): Promise<Set<string>> {
  const rows = await getDb()
    .select({ clientCode: schema.priorityClients.clientCode })
    .from(schema.priorityClients)
  return new Set(rows.map((row) => normalizeClientCode(row.clientCode)).filter(Boolean))
}
