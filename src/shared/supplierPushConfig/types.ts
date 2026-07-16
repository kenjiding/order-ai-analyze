/**
 * 全局供应商推送配置（Catalog）：仅存 webhook / 路由等业务无关字段。
 * 各业务的「启用/禁用」通过 SupplierConfigScope 单独维护，勿写回 catalog。
 */
/** 历史遗留（未按州归属）的供应商配置统一存这个值：不属于任何一个州，全部州可见且可编辑/删除，仅新建时不再使用 */
export const LEGACY_GLOBAL_SUPPLIER_REGION_CODE = 'global'

export type SupplierPushConfig = {
  id: string
  vendorCode: string
  vendorName: string
  supplierNickname: string
  routeCode: string
  /** 路由码白名单（可选）；多码分隔格式与 routeCode 一致 */
  routeCodeWhitelist: string
  /** 该供应商固定归属的站点编码（可选）；司机地图等按站点轮询的业务据此定位站点 */
  stationCode: string
  webhookUrl: string
  signingSecret?: string
  pushDescription: string | null
  pushContent: string
  /** 所属州；服务端已按当前账号所属州过滤，历史遗留数据为 'global'（不属于某个州，全部州可见且可编辑） */
  regionCode: string
}

/** 提交表单不含 id / regionCode：regionCode 由服务端按当前账号所属州决定，不可从客户端传入 */
export type SupplierPushConfigDraft = Omit<SupplierPushConfig, 'id' | 'regionCode'>

/** 与 server/src/supplierConfigScopes/types.ts 保持一致 */
export type SupplierConfigScopeKey =
  | 'vendor-analysis.push'
  | 'work-order-push.scheduled'

export type SupplierConfigScopeBinding = {
  scopeKey: SupplierConfigScopeKey
  enabledIds: string[]
}

export type SupplierConfigScopeAdapter = {
  scopeKey: SupplierConfigScopeKey
  loadEnabledIds(): Promise<{ ok: true; enabledIds: string[] } | { ok: false; error: string }>
  saveEnabledIds(
    enabledIds: string[],
  ): Promise<{ ok: true; enabledIds: string[] } | { ok: false; error: string }>
}

/** @deprecated 兼容旧命名，逐步迁移至 SupplierPushConfig */
export type FleetSupplierConfig = SupplierPushConfig
export type FleetSupplierConfigDraft = SupplierPushConfigDraft
