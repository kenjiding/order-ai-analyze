/** 业务侧「启用哪些供应商配置」的作用域标识；与主配置 catalog 解耦 */
export type SupplierConfigScopeKey = 'vendor-analysis.push'

export type SupplierConfigScopeStore = {
  key: SupplierConfigScopeKey
  /** 读取该业务已启用的 config id 列表 */
  loadEnabledConfigIds(): Promise<string[]>
  /** 持久化启用列表，返回规范化后的 id */
  saveEnabledConfigIds(configIds: string[]): Promise<string[]>
}
