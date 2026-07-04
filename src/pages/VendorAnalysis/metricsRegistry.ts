/**
 * 供应商数据分析的指标注册表（前端侧唯一事实来源，UI 无关、无 JSX）。
 *
 * metricKey 与后端 server/src/vendorAnalysis/metricsCatalog.ts 逐一对应（字符串契约）：
 * - 所有指标均可自由勾选/取消，没有强制常开的固定指标；
 * - 勾选集合决定 analyze 任务抓取哪些数据源（dataSources 并集），未勾选的不请求；
 * - 预览、快照落地页、门户、AI 输入统一按勾选集合过滤渲染。
 * - fixed 字段保留为通用机制（某指标未来若需强制常开可直接置 true），当前全部为 false。
 *
 * 新增指标：在此注册一条 + 后端 catalog 注册一条，再在渲染处按 key 挂上对应的卡片/表格列。
 */

export const VENDOR_ANALYSIS_DATA_SOURCES = [
  'tickets',
  'unprocessed',
  'longTail',
  'before11',
  'waybills',
  'driverWaybills',
  'driverReturn',
] as const

export type VendorAnalysisDataSource = (typeof VENDOR_ANALYSIS_DATA_SOURCES)[number]

export type VendorMetricDef = {
  key: string
  category: 'vendor' | 'driver'
  /** 配置面板展示名（本页 UI 为中文） */
  label: string
  /** 固定指标：勾选框禁用且恒选中 */
  fixed: boolean
  /** 非固定指标的默认勾选状态；用户未显式改过时按此值生效 */
  defaultEnabled: boolean
  dataSources: VendorAnalysisDataSource[]
  /**
   * 日期敏感指标：数据反映“抓取那一刻”的实时状态（是否已在 11 点前出仓 / 是否已在 24H 内派签），
   * 只有「数据参考日期」正好是当天时重新抓取才有意义。非当天时不可再勾选去补拉，只能取消勾选隐藏；
   * 已经合法抓到的历史数据（如加载过去某天的任务）不受影响，仍正常展示。
   */
  dateSensitive?: boolean
}

export const VENDOR_ANALYSIS_METRICS: VendorMetricDef[] = [
  { key: 'vendor.before11ExitRate', category: 'vendor', label: '11点前出仓率', fixed: false, defaultEnabled: true, dataSources: ['before11'], dateSensitive: true },
  { key: 'vendor.dispatch24h', category: 'vendor', label: '24H派签率', fixed: false, defaultEnabled: true, dataSources: ['driverWaybills'], dateSensitive: true },
  { key: 'vendor.complaintRate', category: 'vendor', label: '客诉率', fixed: false, defaultEnabled: true, dataSources: ['tickets', 'waybills'] },
  { key: 'vendor.unprocessedTickets', category: 'vendor', label: '未处理工单', fixed: false, defaultEnabled: true, dataSources: ['unprocessed'] },
  { key: 'vendor.longTail', category: 'vendor', label: '长尾单', fixed: false, defaultEnabled: true, dataSources: ['longTail'] },
  { key: 'driver.todayPickup', category: 'driver', label: '今日取件', fixed: false, defaultEnabled: true, dataSources: ['before11'] },
  { key: 'driver.dispatch24h', category: 'driver', label: '24H派签率', fixed: false, defaultEnabled: true, dataSources: ['driverWaybills'], dateSensitive: true },
  { key: 'driver.before11ExitRate', category: 'driver', label: '11点前出率', fixed: false, defaultEnabled: true, dataSources: ['before11'], dateSensitive: true },
  { key: 'driver.returnWarning', category: 'driver', label: '归班预警', fixed: false, defaultEnabled: true, dataSources: ['driverReturn'] },
  { key: 'driver.longTail', category: 'driver', label: '长尾单', fixed: false, defaultEnabled: true, dataSources: ['longTail'] },
]

/** 日期敏感指标 key 集合，供配置面板禁用勾选框、页面过滤本次实际抓取范围使用 */
export const DATE_SENSITIVE_METRIC_KEYS: ReadonlySet<string> = new Set(
  VENDOR_ANALYSIS_METRICS.filter((m) => m.dateSensitive).map((m) => m.key),
)

/** 服务端用户偏好的存储 key（/api/user-preferences/:key） */
export const METRIC_PREF_KEY = 'vendor-analysis.metrics'

/**
 * 只记录用户显式改过的非固定指标（overrides），而非完整 enabled 数组：
 * 以后注册新指标时，老用户自动按新指标的 defaultEnabled 生效，无需迁移偏好数据。
 */
export type MetricPreferencesValue = {
  v: 1
  overrides: Record<string, boolean>
  aiSummaryEnabled: boolean
}

export const DEFAULT_METRIC_PREFERENCES: MetricPreferencesValue = {
  v: 1,
  overrides: {},
  aiSummaryEnabled: true,
}

/** 偏好 → 生效的指标 key 列表（全部指标均按 overrides ?? defaultEnabled 判定，无强制常开项） */
export function resolveEnabledMetricKeys(prefs: MetricPreferencesValue | null): string[] {
  return VENDOR_ANALYSIS_METRICS.filter(
    (m) => m.fixed || (prefs?.overrides[m.key] ?? m.defaultEnabled),
  ).map((m) => m.key)
}

/**
 * 勾选集合 → 本次实际可用于抓取/校验缺失数据源的指标 key 集合：
 * 参考日期不是当天时，过滤掉日期敏感指标（即便仍勾选，也不会被当作“新增”去补拉数据）。
 */
export function resolveFetchableEnabledKeys(enabledKeys: readonly string[], isReferenceDateToday: boolean): string[] {
  if (isReferenceDateToday) return [...enabledKeys]
  return enabledKeys.filter((key) => !DATE_SENSITIVE_METRIC_KEYS.has(key))
}

/** 勾选集合 → 需要抓取的数据源并集（去重 + 排序，与后端解析结果一致） */
export function resolveDataSources(enabledKeys: readonly string[]): VendorAnalysisDataSource[] {
  const enabled = new Set(enabledKeys)
  const sources = new Set<VendorAnalysisDataSource>()
  for (const m of VENDOR_ANALYSIS_METRICS) {
    if (m.fixed || enabled.has(m.key)) m.dataSources.forEach((s) => sources.add(s))
  }
  return [...sources].sort()
}

/**
 * 已启用的指标 key 列表 → 精确复刻这份勾选状态的 overrides（每个已知指标都显式写 true/false，
 * 不依赖 defaultEnabled）。用于「查看数据」还原某条历史任务提交时的指标配置；
 * 列表里混入的未知/已废弃 key（指标已下线）会被自然忽略。
 */
export function buildOverridesFromEnabledKeys(enabledKeys: readonly string[]): Record<string, boolean> {
  const enabled = new Set(enabledKeys)
  const overrides: Record<string, boolean> = {}
  for (const m of VENDOR_ANALYSIS_METRICS) {
    overrides[m.key] = enabled.has(m.key)
  }
  return overrides
}
