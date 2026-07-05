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
   * 日期敏感指标：数据反映“抓取那一刻”的实时状态（是否已在 11 点前出仓 / 是否已在 24H 内派签）。
   * 与其他指标完全一致地勾选、抓取、展示，不做任何过滤或禁用；此标记仅为元数据，
   * 供新建分析在「数据参考日期」不是当天时提示这些指标可能不准确（历史日期用当前时刻状态回填，参考意义有限）。
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

/**
 * 勾选集合里命中的日期敏感指标展示名（去重）。
 * 供新建分析在「数据参考日期非当天」时提示这些指标可能不准确。
 */
export function enabledDateSensitiveLabels(enabledKeys: readonly string[]): string[] {
  const enabled = new Set(enabledKeys)
  const labels = VENDOR_ANALYSIS_METRICS.filter((m) => m.dateSensitive && enabled.has(m.key)).map((m) => m.label)
  return [...new Set(labels)]
}

/** 全部指标 key，顺序与 registry 一致。新建分析时的默认全选集合。 */
export const ALL_METRIC_KEYS: string[] = VENDOR_ANALYSIS_METRICS.map((m) => m.key)

const METRIC_BY_KEY = new Map(VENDOR_ANALYSIS_METRICS.map((m) => [m.key, m] as const))

/** 指标 key → 「供应商·客诉率」式展示名，供任务队列的「指标配置」列使用 */
export function metricDisplayLabel(key: string): string {
  const m = METRIC_BY_KEY.get(key)
  if (!m) return key
  return `${m.category === 'vendor' ? '供应商' : '司机'}·${m.label}`
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
