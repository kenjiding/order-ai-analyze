/** 「推送数据监控」保留期清理：推送记录与点击事件各自只保留最近 N 天（按各自的时间列独立判定，不做关联查询） */

import { lt } from 'drizzle-orm'
import { getDb, schema } from '../db'

export const PUSH_ENGAGEMENT_RETENTION_DAYS = 30

export async function purgeOldPushEngagementData(
  keepDays = PUSH_ENGAGEMENT_RETENTION_DAYS,
): Promise<{ pushMessages: number; clickEvents: number }> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)
  const db = getDb()
  const deletedClickEvents = await db
    .delete(schema.feishuCardClickEvents)
    .where(lt(schema.feishuCardClickEvents.clickedAt, cutoff))
    .returning({ id: schema.feishuCardClickEvents.id })
  const deletedPushMessages = await db
    .delete(schema.feishuPushMessages)
    .where(lt(schema.feishuPushMessages.createdAt, cutoff))
    .returning({ id: schema.feishuPushMessages.id })
  return { pushMessages: deletedPushMessages.length, clickEvents: deletedClickEvents.length }
}
