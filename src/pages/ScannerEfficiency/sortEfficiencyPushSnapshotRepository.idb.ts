import type { FeishuSortEfficiencyDataSnapshot, SortEfficiencyPushDayRecord } from './feishuSortEfficiencySnapshot'
import { dayjs } from './dayjsSetup'
import { openWarehouseEfficiencyDb } from './weeklyReportRepository'

const PUSH_DAY_SNAPSHOT_STORE = 'sortEfficiencyPushDaySnapshots'

/**
 * 按本地日历日 `YYYY-MM-DD` 写入；同一日多次调用覆盖为最新一条（keyPath: dateKey）。
 */
export async function upsertSortEfficiencyPushDaySnapshot(
  snapshot: FeishuSortEfficiencyDataSnapshot,
  at: Date = new Date(),
): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const dateKey = dayjs(at).format('YYYY-MM-DD')
    const db = await openWarehouseEfficiencyDb()
    const row: SortEfficiencyPushDayRecord = {
      dateKey,
      savedAt: at.toISOString(),
      periodLabel: snapshot.periodLabel,
      snapshot,
    }
    await db.put(PUSH_DAY_SNAPSHOT_STORE, row)
  } catch {
    /* 推送主流程不依赖持久化 */
  }
}

export async function getSortEfficiencyPushDaySnapshot(dateKey: string): Promise<SortEfficiencyPushDayRecord | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openWarehouseEfficiencyDb()
    return (await db.get(PUSH_DAY_SNAPSHOT_STORE, dateKey)) ?? null
  } catch {
    return null
  }
}

/** 相对 `from` 本地日历偏移 `offsetDays` 那天的快照（如 `offsetDays: -1` 即「昨天」） */
export async function getSortEfficiencyPushDaySnapshotByOffset(
  from: Date,
  offsetDays: number,
): Promise<SortEfficiencyPushDayRecord | null> {
  const dateKey = dayjs(from).add(offsetDays, 'day').format('YYYY-MM-DD')
  return getSortEfficiencyPushDaySnapshot(dateKey)
}
