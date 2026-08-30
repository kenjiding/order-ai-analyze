/**
 * 出仓/派签告警目标日的「工作日」推导（后端侧）——避开无分拣的非工作日。
 *
 * 「11点前出仓告警」「24H派签告警」的目标日机械取前一日（prevDateStr）时，周一/周二会
 * 落在周末（周六、周日不分拣、无数据），导致告警拉不到数据。改为从给定日期往前取第一个
 * 工作日。
 *
 * 与前端 src/pages/VendorAnalysis/sortingWorkday.ts 是各自独立的两份实现（前端算供应商
 * 分析页目标日、后端算告警目标日），口径保持一致。
 *
 * 目前只跳周末；`isSortingWorkday` 是唯一扩展点——日后接入各州法定假日表时只在此函数内
 * 按 (regionCode, date) 查表即可，调用方无需改动。
 */

/**
 * dateStr: YYYY-MM-DD。是否为分拣工作日。
 * 当前仅排除周六(6)、周日(0)；预留法定假日扩展点（见文件头注释）。
 */
export function isSortingWorkday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=周日 … 6=周六
  return dow !== 0 && dow !== 6
}

/**
 * 返回 <= dateStr 的第一个工作日（含 dateStr 本身）。入参/出参均为 YYYY-MM-DD。
 * 例：周日 → 上周五；周一（工作日）→ 周一。
 */
export function lastSortingWorkdayOnOrBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const cur = new Date(Date.UTC(y, m - 1, d))
  let s = cur.toISOString().slice(0, 10)
  while (!isSortingWorkday(s)) {
    cur.setUTCDate(cur.getUTCDate() - 1)
    s = cur.toISOString().slice(0, 10)
  }
  return s
}

/**
 * 返回 > dateStr 的第一个工作日（不含 dateStr 本身）。入参/出参均为 YYYY-MM-DD。
 * 例：周四 → 周五；周五 → 下周一；周六 → 下周一。
 *
 * **不要拿它推「出仓日」**：分拣日历只管「哪天开仓分拣」，不管哪天出仓。周五分拣好的货，
 * 司机周六照常来 11 点前取货出仓派送——「不开仓分拣」不等于「不出仓派送」。出仓日恒为
 * 分拣日次日，见 vendorAnalysis/dispatch24hAggregate 的 resolveExitDate。
 */
export function nextSortingWorkdayAfter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const cur = new Date(Date.UTC(y, m - 1, d))
  do {
    cur.setUTCDate(cur.getUTCDate() + 1)
  } while (!isSortingWorkday(cur.toISOString().slice(0, 10)))
  return cur.toISOString().slice(0, 10)
}
