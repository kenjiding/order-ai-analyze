/**
 * 流转记录变更 → 飞书私聊通知。
 *
 * 收件人来自转出方与接收方两个站点账户各自的 pushNotify 配置，openId 去重后合并；
 * 选群只用于在配置界面拉取成员名单，这里始终按 open_id 私聊，不在群里发。
 *
 * 调用方在业务提交成功后 fire-and-forget，通知失败只记日志，不回滚也不影响接口返回。
 */
import { inArray } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { getFeishuTenantAccessToken } from '../feishuServerEnv'
import { sendFeishuAppMessage } from '../feishu/feishuAppMessage'
import { formatTransferNo } from './constants'
import {
  buildContainerTransferCard,
  type TransferCardEvent,
} from '../feishu/buildContainerTransferCard'
import { normalizeAccountPushNotify, type MentionContact } from './pushNotify'
import type { TransferView } from './transferService'

/** 与卡片构建器共用同一套事件枚举，避免两处维护 */
export type TransferNotifyEvent = TransferCardEvent

/** 收件人在这笔流转里的身份，决定卡片给他哪个按钮 */
export type TransferSide = 'from' | 'to'

export type TransferRecipient = MentionContact & {
  /** 同一个人可能同时是两边的联系人 */
  sides: TransferSide[]
}

/**
 * 两个站点各自配置的收件人合并去重；未启用或没配人的站点直接跳过。
 * 导出以便回答「这笔流转会通知谁」，通知本身走 notifyTransferEvent。
 */
export async function resolveTransferNotifyRecipients(
  fromAccountId: string,
  toAccountId: string,
): Promise<TransferRecipient[]> {
  const rows = await getDb()
    .select({
      id: schema.containerAccounts.id,
      pushNotify: schema.containerAccounts.pushNotify,
    })
    .from(schema.containerAccounts)
    .where(inArray(schema.containerAccounts.id, [fromAccountId, toAccountId]))

  const byOpenId = new Map<string, TransferRecipient>()
  for (const row of rows) {
    const config = normalizeAccountPushNotify(row.pushNotify)
    if (!config.enabled) continue
    const side: TransferSide | null =
      row.id === fromAccountId ? 'from' : row.id === toAccountId ? 'to' : null
    if (!side) continue
    for (const contact of config.mentions) {
      const existing = byOpenId.get(contact.openId)
      if (existing) {
        if (!existing.sides.includes(side)) existing.sides.push(side)
      } else {
        byOpenId.set(contact.openId, { ...contact, sides: [side] })
      }
    }
  }
  return [...byOpenId.values()]
}

/**
 * 通知一笔流转的双方联系人。永不抛出：任何失败都落到 console.error。
 * @param extra 事件附带的正文，例如创建备注、申报原因、收货备注
 */
export async function notifyTransferEvent(
  transfer: TransferView,
  event: TransferNotifyEvent,
  actorName: string,
  extra: string | null = null,
): Promise<void> {
  try {
    const recipients = await resolveTransferNotifyRecipients(
      transfer.fromAccountId,
      transfer.toAccountId,
    )
    if (recipients.length === 0) return

    const tokenResult = await getFeishuTenantAccessToken()
    if (!tokenResult.ok) {
      console.error(`[container-transfer-notify] 获取飞书 tenant token 失败：${tokenResult.reason}`)
      return
    }

    let failed = 0
    for (const contact of recipients) {
      // 逐人发，所以卡片可以按收件人在这笔流转里的身份给不同的按钮
      const card = buildContainerTransferCard({
        transfer,
        event,
        actorName,
        extra,
        sides: contact.sides,
      })
      const res = await sendFeishuAppMessage(
        tokenResult.token,
        contact.openId,
        'interactive',
        card,
        'open_id',
      )
      if (!res.ok) {
        failed += 1
        console.error(
          `[container-transfer-notify] ${formatTransferNo(transfer.id)} 私聊 ${contact.name || contact.openId} 失败：${res.error}`,
        )
      }
    }
    if (failed > 0) {
      console.error(
        `[container-transfer-notify] ${formatTransferNo(transfer.id)} ${event}：${recipients.length} 人中 ${failed} 人未送达`,
      )
    }
  } catch (error) {
    console.error(`[container-transfer-notify] ${formatTransferNo(transfer.id)} ${event} 通知异常`, error)
  }
}
