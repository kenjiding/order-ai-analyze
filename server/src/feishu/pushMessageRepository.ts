import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { feishuPushMessages } from '../db/schema'
import type { FeishuPushMessage } from '../db/schema'

export async function insertFeishuPushMessage(input: {
  supplierConfigId?: string | null
  chatId: string
  messageId: string
  msgType: string
  pushLabel?: string | null
  createdBy?: string | null
}): Promise<FeishuPushMessage> {
  const db = getDb()
  const [row] = await db
    .insert(feishuPushMessages)
    .values({
      supplierConfigId: input.supplierConfigId ?? null,
      chatId: input.chatId,
      messageId: input.messageId,
      msgType: input.msgType,
      pushLabel: input.pushLabel ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning()
  return row!
}

/** 按供应商配置查最近的推送消息（供「查看已读」入口列表使用），倒序、最多 20 条 */
export async function listFeishuPushMessagesBySupplier(supplierConfigId: string): Promise<FeishuPushMessage[]> {
  const db = getDb()
  return db
    .select()
    .from(feishuPushMessages)
    .where(eq(feishuPushMessages.supplierConfigId, supplierConfigId))
    .orderBy(desc(feishuPushMessages.createdAt))
    .limit(20)
}

export async function getFeishuPushMessageById(id: string): Promise<FeishuPushMessage | null> {
  const db = getDb()
  const [row] = await db.select().from(feishuPushMessages).where(eq(feishuPushMessages.id, id)).limit(1)
  return row ?? null
}
