import { desc, eq, sql } from 'drizzle-orm'
import { getDb } from './db'
import { orderExceptionUsageStats, users } from './db/schema'

export type UsageStatField = 'analyzedOrderCount' | 'orderClickCount' | 'exportCount' | 'closureAddCount'

const FIELD_COLUMN = {
  analyzedOrderCount: orderExceptionUsageStats.analyzedOrderCount,
  orderClickCount: orderExceptionUsageStats.orderClickCount,
  exportCount: orderExceptionUsageStats.exportCount,
  closureAddCount: orderExceptionUsageStats.closureAddCount,
} as const

/** 原子累加：不存在则插入初始行，存在则 count = count + amount，不记流水。 */
export async function incrementUsageStat(userId: string, field: UsageStatField, amount: number): Promise<void> {
  if (amount <= 0) return
  const db = getDb()
  const column = FIELD_COLUMN[field]
  await db
    .insert(orderExceptionUsageStats)
    .values({ userId, [field]: amount })
    .onConflictDoUpdate({
      target: orderExceptionUsageStats.userId,
      set: { [field]: sql`${column} + ${amount}`, updatedAt: sql`now()` },
    })
}

/** 埋点失败不影响主流程，只记日志；供路由 fire-and-forget 调用。 */
export function recordUsage(userId: string, field: UsageStatField, amount = 1): void {
  incrementUsageStat(userId, field, amount).catch((err) => {
    console.error(`[order-exception-usage] 记录 ${field} 失败`, err)
  })
}

export type UsageStatRow = {
  userId: string
  username: string
  displayName: string | null
  analyzedOrderCount: number
  orderClickCount: number
  exportCount: number
  closureAddCount: number
  updatedAt: string
}

export async function listUsageStats(): Promise<UsageStatRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      userId: orderExceptionUsageStats.userId,
      username: users.username,
      displayName: users.displayName,
      analyzedOrderCount: orderExceptionUsageStats.analyzedOrderCount,
      orderClickCount: orderExceptionUsageStats.orderClickCount,
      exportCount: orderExceptionUsageStats.exportCount,
      closureAddCount: orderExceptionUsageStats.closureAddCount,
      updatedAt: orderExceptionUsageStats.updatedAt,
    })
    .from(orderExceptionUsageStats)
    .innerJoin(users, eq(users.id, orderExceptionUsageStats.userId))
    .orderBy(desc(orderExceptionUsageStats.analyzedOrderCount))

  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
}
