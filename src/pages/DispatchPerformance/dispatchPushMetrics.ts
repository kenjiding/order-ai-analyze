/**
 * 数据推送弹层可勾选的指标：key 与 DispatchMetrics 字段一一对应，
 * label 复用 PerformanceBreakdownTable 已有的 breakdown.* i18n key，不重复定义文案。
 * 供应商利润不对外推送，不在此列表里。
 */
export type DispatchPushMetricKey =
  | 'total'
  | 'before11Rate'
  | 'sameDayExitRate'
  | 'signRate'
  | 'nextDaySignRate'
  | 'priorityNextDaySignRate'
  | 'problemCount'

export const DISPATCH_PUSH_METRIC_ALL_KEYS: DispatchPushMetricKey[] = [
  'priorityNextDaySignRate',
  'nextDaySignRate',
  'total',
  'before11Rate',
  'sameDayExitRate',
  'signRate',
  'problemCount',
]

const METRIC_LABEL_KEYS: Record<DispatchPushMetricKey, string> = {
  total: 'breakdown.totalWaybills',
  before11Rate: 'breakdown.before11HubExitRate',
  sameDayExitRate: 'breakdown.sameDayExitRate',
  signRate: 'breakdown.signRate24h',
  nextDaySignRate: 'breakdown.nextDaySignRate',
  priorityNextDaySignRate: 'breakdown.priorityNextDaySignRate',
  problemCount: 'breakdown.problemWaybills',
}

export function dispatchPushMetricLabelKey(key: DispatchPushMetricKey): string {
  return METRIC_LABEL_KEYS[key]
}
