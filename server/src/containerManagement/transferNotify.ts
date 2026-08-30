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
import {
  buildContainerTransferBatchCard,
  type TransferBatchEntry,
} from '../feishu/buildContainerTransferBatchCard'
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
  const contactsByAccount = await loadAccountContacts([fromAccountId, toAccountId])
  return collectRecipients(contactsByAccount, fromAccountId, toAccountId)
}

/**
 * 一次查出多个站点账户的联系人，未启用推送的账户不进结果。
 * 批量通知靠这个把 N 笔流转压成一次查询，别在循环里调 resolveTransferNotifyRecipients。
 */
async function loadAccountContacts(accountIds: string[]): Promise<Map<string, MentionContact[]>> {
  const ids = [...new Set(accountIds)].filter((id) => id)
  if (ids.length === 0) return new Map()

  const rows = await getDb()
    .select({
      id: schema.containerAccounts.id,
      pushNotify: schema.containerAccounts.pushNotify,
    })
    .from(schema.containerAccounts)
    .where(inArray(schema.containerAccounts.id, ids))

  const byAccount = new Map<string, MentionContact[]>()
  for (const row of rows) {
    const config = normalizeAccountPushNotify(row.pushNotify)
    if (!config.enabled || config.mentions.length === 0) continue
    byAccount.set(row.id, config.mentions)
  }
  return byAccount
}

/** 两侧联系人按 openId 合并去重；同一个人同时是双方联系人时 sides 会有两项。纯内存，不查库。 */
function collectRecipients(
  contactsByAccount: Map<string, MentionContact[]>,
  fromAccountId: string,
  toAccountId: string,
): TransferRecipient[] {
  const byOpenId = new Map<string, TransferRecipient>()
  const sides: Array<[string, TransferSide]> = [
    [fromAccountId, 'from'],
    [toAccountId, 'to'],
  ]
  for (const [accountId, side] of sides) {
    for (const contact of contactsByAccount.get(accountId) ?? []) {
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

/**
 * 少于等于这个笔数时仍逐笔发单笔卡片：信息更全、能直接点进那一笔确认收货；
 * 超过就归并成汇总卡，避免一次导入把接收方私聊刷屏。
 */
const BATCH_NOTIFY_THRESHOLD = 2

export type BatchRecipientBucket = { contact: MentionContact; entries: TransferBatchEntry[] }

/**
 * 把 N 笔流转按收件人归并：一个人同时是多个站点的联系人时，这些站点的流转都进他那一个桶。
 * 纯内存，导出以便单测。
 */
export function groupBatchEntriesByRecipient(
  contactsByAccount: Map<string, MentionContact[]>,
  transfers: TransferView[],
): Map<string, BatchRecipientBucket> {
  const byOpenId = new Map<string, BatchRecipientBucket>()
  for (const transfer of transfers) {
    for (const recipient of collectRecipients(
      contactsByAccount,
      transfer.fromAccountId,
      transfer.toAccountId,
    )) {
      let bucket = byOpenId.get(recipient.openId)
      if (!bucket) {
        bucket = { contact: { name: recipient.name, openId: recipient.openId }, entries: [] }
        byOpenId.set(recipient.openId, bucket)
      }
      bucket.entries.push({ transfer, sides: recipient.sides })
    }
  }
  return byOpenId
}

/**
 * 批量新建（Excel 导入 / 手工多组提交）的通知入口。永不抛出。
 *
 * 归并维度是「人」不是「站点线路」：一个人可能是好几个站点的联系人，
 * 按 openId 归并后他只收一条，卡片里再按他在各笔中的身份分块。
 */
export async function notifyTransferBatchCreated(
  transfers: TransferView[],
  actorName: string,
): Promise<void> {
  if (transfers.length === 0) return
  if (transfers.length <= BATCH_NOTIFY_THRESHOLD) {
    for (const transfer of transfers) {
      await notifyTransferEvent(
        transfer,
        'created',
        actorName,
        transfer.note ? `备注：${transfer.note}` : null,
      )
    }
    return
  }

  try {
    const contactsByAccount = await loadAccountContacts(
      transfers.flatMap((transfer) => [transfer.fromAccountId, transfer.toAccountId]),
    )
    if (contactsByAccount.size === 0) return

    const byOpenId = groupBatchEntriesByRecipient(contactsByAccount, transfers)
    if (byOpenId.size === 0) return

    const tokenResult = await getFeishuTenantAccessToken()
    if (!tokenResult.ok) {
      console.error(`[container-transfer-notify] 获取飞书 tenant token 失败：${tokenResult.reason}`)
      return
    }

    let failed = 0
    for (const { contact, entries } of byOpenId.values()) {
      const card = buildContainerTransferBatchCard({ entries, actorName })
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
          `[container-transfer-notify] 批量 ${transfers.length} 笔私聊 ${contact.name || contact.openId} 失败：${res.error}`,
        )
      }
    }
    console.info(
      `[container-transfer-notify] 批量 ${transfers.length} 笔已归并为 ${byOpenId.size} 条推送，失败 ${failed} 条`,
    )
  } catch (error) {
    console.error(`[container-transfer-notify] 批量 ${transfers.length} 笔通知异常`, error)
  }
}
