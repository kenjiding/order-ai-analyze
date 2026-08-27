import type { SupplierMentionContact } from '../shared/supplierPushConfig/types'

/**
 * 站点账户的流转通知配置：一笔流转变更时，转出方与接收方各自配置的联系人都会收到私聊。
 * 与 iMile token 失效通知同一套做法，选群只用于拉取成员名单，不在群里发。
 */
export type AccountPushNotify = {
  enabled: boolean
  chatId: string
  mentions: SupplierMentionContact[]
}

export const DEFAULT_ACCOUNT_PUSH_NOTIFY: AccountPushNotify = {
  enabled: false,
  chatId: '',
  mentions: [],
}

export function normalizeAccountPushNotify(
  raw: Partial<AccountPushNotify> | null | undefined,
): AccountPushNotify {
  const mentions = Array.isArray(raw?.mentions) ? raw.mentions : []
  return {
    enabled: raw?.enabled === true,
    chatId: typeof raw?.chatId === 'string' ? raw.chatId.trim() : '',
    mentions: mentions
      .filter((m): m is SupplierMentionContact => Boolean(m) && typeof m === 'object')
      .map((m) => ({ name: String(m.name ?? '').trim(), openId: String(m.openId ?? '').trim() }))
      .filter((m) => m.openId.length > 0),
  }
}
