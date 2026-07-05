/** 主配置维护入口（车队供应商推送页） */
export const SUPPLIER_PUSH_CONFIG_MAINTAIN_PATH = '/push-notifications'

export const SUPPLIER_CONFIG_SCOPE_LABELS: Record<
  import('./types').SupplierConfigScopeKey,
  string
> = {
  'exit-alarm.scheduled': '状态',
  'vendor-analysis.push': '状态',
  'chase-dispatch.scheduled': '状态',
}
