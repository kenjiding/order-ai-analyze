/** 扫描员「修正效率(票/小时)」严格小于该值时，汇总表与柱状图用淡橙色警示 */
export const SCANNER_ADJUSTED_EFFICIENCY_RED_LT = 460

export function isScannerAdjustedEfficiencyLow(value: number): boolean {
  return Number.isFinite(value) && value < SCANNER_ADJUSTED_EFFICIENCY_RED_LT
}

/** 分拣员「总效率(票/小时)」严格小于该值时，汇总表与柱状图用淡橙色警示 */
export const SCANNER_TOTAL_EFFICIENCY_RED_LT = 180

export function isScannerTotalEfficiencyLow(value: number): boolean {
  return Number.isFinite(value) && value < SCANNER_TOTAL_EFFICIENCY_RED_LT
}

/** 汇总柱状图：达标 / 低于阈值（与分拣员总效率一致） */
export const SCANNER_EFFICIENCY_CHART_FILL_NORMAL = '#2f8f87'
export const SCANNER_EFFICIENCY_CHART_FILL_LOW = '#fdba74'

/** 汇总表格：低于阈值时的文字色 */
export const SCANNER_EFFICIENCY_TABLE_LOW_CLASS = 'font-semibold tabular-nums text-orange-400'
export const SCANNER_EFFICIENCY_TABLE_NORMAL_CLASS = 'tabular-nums text-slate-900'
