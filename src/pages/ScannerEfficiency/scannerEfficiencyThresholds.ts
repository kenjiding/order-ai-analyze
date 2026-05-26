/** 扫描员「修正效率(票/小时)」严格小于该值时，汇总表与柱状图用红色警示 */
export const SCANNER_ADJUSTED_EFFICIENCY_RED_LT = 460

export function isScannerAdjustedEfficiencyLow(value: number): boolean {
  return Number.isFinite(value) && value < SCANNER_ADJUSTED_EFFICIENCY_RED_LT
}
