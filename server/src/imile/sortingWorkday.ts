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
 * **两套独立日历**，默认都是「周一到周五 true」，但彼此会独立出现例外（见
 * `RegionCalendarOverrides` 的注释）：
 * - 出仓日历（`isSortingWorkday`/`nextSortingWorkdayAfter`/`lastSortingWorkdayOnOrBefore`）：
 *   这天能不能把已分拣的货扫描出仓。公共假期这天默认仍是 true（早取服务照常），
 *   周末临时开仓分拣时需要显式覆盖成 true。
 * - 派送日历（`isDispatchDay`/`nextDispatchDayAfter`）：这天司机会不会出车派送。
 *   公共假期需要显式覆盖成 false；周末临时开仓分拣但司机未必跟着出车，默认沿用 false。
 *
 * 不传 `overrides`（或传空表）时两套日历都退化成纯周末判断，与接入假期表之前的行为完全一致。
 */

import { envFirst } from './shared'

/** (regionCode, date) → 该日的出仓/派送例外覆盖，null/未命中 = 不覆盖，沿用默认（周一到周五 true） */
export type RegionCalendarOverrides = Map<string, { isExitDay?: boolean | null; isDispatchDay?: boolean | null }>

function isWeekday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=周日 … 6=周六
  return dow !== 0 && dow !== 6
}

function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const cur = new Date(Date.UTC(y, m - 1, d))
  cur.setUTCDate(cur.getUTCDate() + days)
  return cur.toISOString().slice(0, 10)
}

/**
 * dateStr: YYYY-MM-DD。这天能不能把已分拣的货扫描出仓（出仓日历）。
 * 默认仅排除周六(6)、周日(0)；`overrides` 命中时按表里的值覆盖。
 */
export function isSortingWorkday(dateStr: string, overrides: RegionCalendarOverrides = new Map()): boolean {
  const override = overrides.get(dateStr)?.isExitDay
  return override ?? isWeekday(dateStr)
}

/** 这天司机会不会出车派送（派送日历）。默认仅排除周六、周日；`overrides` 命中时按表里的值覆盖。 */
export function isDispatchDay(dateStr: string, overrides: RegionCalendarOverrides = new Map()): boolean {
  const override = overrides.get(dateStr)?.isDispatchDay
  return override ?? isWeekday(dateStr)
}

/**
 * 返回 <= dateStr 的第一个出仓日历工作日（含 dateStr 本身）。入参/出参均为 YYYY-MM-DD。
 * 例：周日 → 上周五；周一（工作日）→ 周一。
 */
export function lastSortingWorkdayOnOrBefore(
  dateStr: string,
  overrides: RegionCalendarOverrides = new Map(),
): string {
  let s = dateStr
  while (!isSortingWorkday(s, overrides)) s = shiftDateStr(s, -1)
  return s
}

/**
 * 返回 > dateStr 的第一个出仓日历工作日（不含 dateStr 本身）。入参/出参均为 YYYY-MM-DD。
 * 例：周四 → 周五；周五 → 下周一；周六 → 下周一。
 *
 * 出仓日也用它：周五/六/日到件的 11 点前出仓截止是下周一 11:00，见 resolveExitDate。
 */
export function nextSortingWorkdayAfter(dateStr: string, overrides: RegionCalendarOverrides = new Map()): string {
  let s = shiftDateStr(dateStr, 1)
  while (!isSortingWorkday(s, overrides)) s = shiftDateStr(s, 1)
  return s
}

/**
 * 返回 > dateStr 的第一个派送日历工作日（不含 dateStr 本身），用途与 nextSortingWorkdayAfter
 * 相同但查的是派送日历——resolveDispatch24hWindowRule 的固定延期目标用它。
 */
export function nextDispatchDayAfter(dateStr: string, overrides: RegionCalendarOverrides = new Map()): string {
  let s = shiftDateStr(dateStr, 1)
  while (!isDispatchDay(s, overrides)) s = shiftDateStr(s, 1)
  return s
}

/**
 * 返回 lastSortingWorkdayOnOrBefore(dateStr) 到 dateStr 本身的全部日历日（含两端），供告警目标日
 * 的「到件日」参数用——工作日（如周一推送目标日=周五）回退跳过的周末顺带一起拉：没开仓那天 inbound
 * 本来就接近 0，带上不影响统计；真遇到周末临时开仓分拣时不会漏算那批数据。
 * dateStr 本身就是工作日时退化成单日 [dateStr]，与原逻辑一致。
 */
export function sortingWorkdayCatchUpDates(
  dateStr: string,
  overrides: RegionCalendarOverrides = new Map(),
): string[] {
  const start = lastSortingWorkdayOnOrBefore(dateStr, overrides)
  const dates: string[] = []
  let s = start
  while (s <= dateStr) {
    dates.push(s)
    s = shiftDateStr(s, 1)
  }
  return dates
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
