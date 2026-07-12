import type { Dayjs } from 'dayjs'

/**
 * 「11点前出仓率」「24H派签率」的目标日推导——避开无分拣的非工作日。
 *
 * 背景：两个指标机械地取运行日 D-1 / D-2 时，周一/周二会落在周末（周六、周日不分拣、无数据），
 * 导致指标算不出（total=0 → null）。改为「往前找最近的工作日」：
 * - 出仓率目标日 = 运行日往前第一个工作日（prevWorkday(referenceDate)）
 * - 派签率目标日 = 出仓率目标日再往前一个工作日（prevWorkday(出仓率目标日)）
 *
 * 目前只跳周末；`isWorkday` 是唯一的扩展点——日后接入各州法定假日表时只改这里，
 * 调用方与聚合/判定逻辑均无需改动。
 */

/** 是否为分拣工作日。当前仅排除周六(6)、周日(0)；预留法定假日扩展点。 */
export function isWorkday(date: Dayjs): boolean {
  const dow = date.day() // 0=周日 … 6=周六
  return dow !== 0 && dow !== 6
}

/** 返回 date 之前（不含 date 本身）最近的一个工作日。 */
export function prevWorkday(date: Dayjs): Dayjs {
  let d = date.subtract(1, 'day')
  while (!isWorkday(d)) d = d.subtract(1, 'day')
  return d
}
