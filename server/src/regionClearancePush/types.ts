import type { DispatchDeliveredStat, InventoryStat } from './aggregate'

export type RegionStationEntry = { code: string; name: string }

/** 上一次定时推送时的今日数据/今日库存快照，存在 schedule.lastSnapshot（jsonb）里，推送卡片用来算趋势 */
export type RegionClearanceSnapshot = {
  todayStat: DispatchDeliveredStat
  inventoryStat: InventoryStat
}

/** 读 schedule.lastSnapshot；为空（首次推送）或形状不对时返回 null，卡片就不展示对比 */
export function parseRegionClearanceSnapshot(raw: unknown): RegionClearanceSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (!obj.todayStat || !obj.inventoryStat) return null
  return { todayStat: obj.todayStat as DispatchDeliveredStat, inventoryStat: obj.inventoryStat as InventoryStat }
}

export function parseStationEntries(raw: unknown): RegionStationEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      code: typeof item.code === 'string' ? item.code.trim() : '',
      name: typeof item.name === 'string' ? item.name.trim() : '',
    }))
    .filter((item) => item.code.length > 0)
}
