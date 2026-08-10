import { desc, eq, inArray } from 'drizzle-orm'
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

/** 按一组 id 批量查询推送记录，供「推送数据监控」展开行的批量已读/点击详情接口使用 */
export async function getFeishuPushMessagesByIds(ids: string[]): Promise<FeishuPushMessage[]> {
  if (ids.length === 0) return []
  const db = getDb()
  return db.select().from(feishuPushMessages).where(inArray(feishuPushMessages.id, ids))
}

/**
 * 定时推送发送成功后落库 message_id，供「推送数据监控」查已读/关联点击事件。
 * 仅 chatId（应用机器人）通道有 messageId；webhook 通道无 messageId 时静默跳过。
 * 落库失败不影响推送主流程，仅打日志（该次推送已经成功发出）。
 */
export async function recordFeishuPushMessage(input: {
  supplierConfigId: string
  chatId?: string | null
  messageId?: string | null
  pushLabel: string
}): Promise<void> {
  if (!input.chatId || !input.messageId) return
  try {
    await insertFeishuPushMessage({
      supplierConfigId: input.supplierConfigId,
      chatId: input.chatId,
      messageId: input.messageId,
      msgType: 'interactive',
      pushLabel: input.pushLabel,
    })
  } catch (err) {
    console.error('[feishu-push-message] 记录 message_id 失败（不影响本次推送，仅无法查已读/点击）:', err)
  }
}
