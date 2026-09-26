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

import { envFirst } from './shared'

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
 * 出仓日也用它：周五/六/日到件的 11 点前出仓截止是下周一 11:00，见 resolveExitDate。
 */
export function nextSortingWorkdayAfter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const cur = new Date(Date.UTC(y, m - 1, d))
  do {
    cur.setUTCDate(cur.getUTCDate() + 1)
  } while (!isSortingWorkday(cur.toISOString().slice(0, 10)))
  return cur.toISOString().slice(0, 10)
}

/**
 * 到件量低于此数视为「这天没开仓分拣」。
 *
 * 不能用「有没有数据」判：没开仓那天值班员工照样会零星扫几十单入库，inbound 接口返回的
 * 是很低而不是 0。真开仓的日子一天几千单，两者差一两个数量级，一个阈值就分得开。
 * env `MIN_SORTING_WAYBILLS` 可覆盖（各站点体量差得远时再改成按站点配置）。
 */
export const MIN_SORTING_WAYBILLS = (() => {
  const n = Number(envFirst('MIN_SORTING_WAYBILLS'))
  return Number.isFinite(n) && n > 0 ? n : 2000
})()

/**
 * 这天的到件量是否低到判定为「没开仓分拣」——没有批次，不统计也不推送。
 *
 * 没开仓的那天不影响前后批次：前一天到件的货当天照常出仓派送（仓库只是没有新货到，
 * 不是关门），所以出仓日推导（resolveExitDate）不受此判定影响，只有「这天自己那批」消失。
 */
export function isNoSortingBatch(waybillCount: number, threshold: number = MIN_SORTING_WAYBILLS): boolean {
  return waybillCount < threshold
}
