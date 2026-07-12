import { asc, eq, or } from 'drizzle-orm'
import { getDb, schema } from './db'
import type { FleetSupplierPushConfig } from './db/schema'

/** 历史遗留（未按州归属）的供应商配置统一存这个值：不属于任何一个州，全部州可见且可编辑/删除，仅新建时不再使用 */
export const LEGACY_GLOBAL_SUPPLIER_REGION_CODE = 'global'

export type SupplierPushConfigBody = {
  vendorCode?: unknown
  vendorName?: unknown
  supplierNickname?: unknown
  routeCode?: unknown
  routeCodeWhitelist?: unknown
  stationCode?: unknown
  webhookUrl?: unknown
  signingSecret?: unknown
  pushDescription?: unknown
  pushContent?: unknown
}

export function supplierDisplayName(config: Pick<FleetSupplierPushConfig, 'supplierNickname' | 'vendorName'>): string {
  const nick = config.supplierNickname?.trim()
  if (nick) return nick
  return config.vendorName?.trim() || '未知供应商'
}

export function isSupplierWebhookConfigured(webhookUrl: string | null | undefined): boolean {
  return typeof webhookUrl === 'string' && webhookUrl.trim().length > 0
}

export function extractSupplierPushConfigFields(body: SupplierPushConfigBody) {
  return {
    vendorCode: typeof body.vendorCode === 'string' ? body.vendorCode.trim() : '',
    vendorName: typeof body.vendorName === 'string' ? body.vendorName.trim() : '',
    supplierNickname: typeof body.supplierNickname === 'string' ? body.supplierNickname.trim() : '',
    routeCode: typeof body.routeCode === 'string' ? body.routeCode : '',
    routeCodeWhitelist: typeof body.routeCodeWhitelist === 'string' ? body.routeCodeWhitelist : '',
    stationCode: typeof body.stationCode === 'string' ? body.stationCode.trim() : '',
    webhookUrl: typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : '',
    signingSecret:
      typeof body.signingSecret === 'string' && body.signingSecret.trim()
        ? body.signingSecret.trim()
        : null,
    pushDescription:
      typeof body.pushDescription === 'string' && body.pushDescription.trim()
        ? body.pushDescription.trim()
        : null,
    pushContent: typeof body.pushContent === 'string' ? body.pushContent : '',
  }
}

export function validateSupplierPushConfigCreate(body: SupplierPushConfigBody): string | null {
  const fields = extractSupplierPushConfigFields(body)
  if (!fields.vendorCode) return '缺少必填字段: vendorCode'
  if (!fields.vendorName) return '缺少必填字段: vendorName'
  if (!fields.supplierNickname) return '缺少必填字段: supplierNickname'
  if (!fields.routeCode.trim()) return '缺少必填字段: routeCode'
  if (!fields.webhookUrl) return '缺少必填字段: webhookUrl'
  return null
}

export function validateSupplierPushConfigUpdate(body: SupplierPushConfigBody): string | null {
  const fields = extractSupplierPushConfigFields(body)
  if (!fields.vendorCode) return '缺少必填字段: vendorCode'
  if (!fields.vendorName) return '缺少必填字段: vendorName'
  if (!fields.supplierNickname) return '缺少必填字段: supplierNickname'
  if (typeof body.routeCode !== 'string') return '缺少必填字段: routeCode'
  if (!fields.webhookUrl) return '缺少必填字段: webhookUrl'
  return null
}

/**
 * 不传 regionCode 时返回全表（供 scope 按 id 解析使用，与州无关）。
 * 传入 regionCode 时，只返回「同州」+「历史遗留全局」两类，即当前账号能看到的范围。
 */
export async function listSupplierPushConfigs(regionCode?: string): Promise<FleetSupplierPushConfig[]> {
  const db = getDb()
  const query = db.select().from(schema.fleetSupplierPushConfigs)
  const rows = regionCode
    ? await query
        .where(
          or(
            eq(schema.fleetSupplierPushConfigs.regionCode, regionCode),
            eq(schema.fleetSupplierPushConfigs.regionCode, LEGACY_GLOBAL_SUPPLIER_REGION_CODE),
          ),
        )
        .orderBy(asc(schema.fleetSupplierPushConfigs.createdAt))
    : await query.orderBy(asc(schema.fleetSupplierPushConfigs.createdAt))
  return rows
}

/** 解析路由码字符串：支持空格、换行、英文逗号、中文逗号分隔 */
export function parseRouteCodes(raw: string): string[] {
  return raw
    .split(/[\s,，]+/)
    .map((r) => r.trim())
    .filter(Boolean)
}

/** 路由码白名单：命中的路由码代表要从该供应商统计中剔除的数据 */
export function parseRouteCodeWhitelistSet(routeCodeWhitelist: string): Set<string> {
  return new Set(parseRouteCodes(routeCodeWhitelist))
}

export function parsePushConfigIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim())
}

export async function listSupplierPushConfigsByIds(ids: string[]): Promise<FleetSupplierPushConfig[]> {
  if (!ids.length) return []
  const idSet = new Set(ids)
  const rows = await listSupplierPushConfigs()
  return rows.filter(
    (c) => idSet.has(c.id) && isSupplierWebhookConfigured(c.webhookUrl),
  )
}

export async function listPushableSupplierPushConfigsByIds(ids: string[]): Promise<FleetSupplierPushConfig[]> {
  return listSupplierPushConfigsByIds(ids)
}
