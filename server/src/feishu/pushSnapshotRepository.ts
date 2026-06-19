import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { feishuPushSnapshots } from '../db/schema'

export async function upsertFeishuPushSnapshot(
  regionCode: string,
  periodLabel: string,
  snapshot: unknown,
): Promise<void> {
  const db = getDb()
  const now = new Date()
  await db
    .insert(feishuPushSnapshots)
    .values({ regionCode, periodLabel, snapshot, pushedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: feishuPushSnapshots.regionCode,
      set: { periodLabel, snapshot, pushedAt: now, updatedAt: now },
    })
}

export async function getLatestFeishuPushSnapshot(regionCode: string) {
  const db = getDb()
  const [row] = await db
    .select()
    .from(feishuPushSnapshots)
    .where(eq(feishuPushSnapshots.regionCode, regionCode))
    .limit(1)
  return row ?? null
}
