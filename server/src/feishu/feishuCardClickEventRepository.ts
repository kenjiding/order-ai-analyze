import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { feishuCardClickEvents } from '../db/schema'
import type { FeishuCardClickEvent } from '../db/schema'

export async function insertFeishuCardClickEvent(input: {
  messageId: string
  supplierConfigId?: string | null
  openId: string
  actionType: string
  pushType: string
}): Promise<FeishuCardClickEvent> {
  const db = getDb()
  const [row] = await db
    .insert(feishuCardClickEvents)
    .values({
      messageId: input.messageId,
      supplierConfigId: input.supplierConfigId ?? null,
      openId: input.openId,
      actionType: input.actionType,
      pushType: input.pushType,
    })
    .returning()
  return row!
}

/** 按 messageId 查点击事件（倒序），供「点击记录」详情展示 */
export async function listFeishuCardClickEventsByMessageId(messageId: string): Promise<FeishuCardClickEvent[]> {
  const db = getDb()
  return db
    .select()
    .from(feishuCardClickEvents)
    .where(eq(feishuCardClickEvents.messageId, messageId))
    .orderBy(desc(feishuCardClickEvents.clickedAt))
}
