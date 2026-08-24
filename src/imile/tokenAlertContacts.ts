import type { SupplierMentionContact } from '../shared/supplierPushConfig'

/** iMile token 失效时的通知对象：选群用于拉取成员名单，实际通知走私聊 */
export type TokenAlertContacts = {
  chatId: string
  mentions: SupplierMentionContact[]
}

export const DEFAULT_TOKEN_ALERT_CONTACTS: TokenAlertContacts = {
  chatId: '',
  mentions: [],
}

export function normalizeTokenAlertContacts(
  raw: Partial<TokenAlertContacts> | null | undefined,
): TokenAlertContacts {
  const mentions = Array.isArray(raw?.mentions) ? raw.mentions : []
  return {
    chatId: typeof raw?.chatId === 'string' ? raw.chatId.trim() : '',
    mentions: mentions
      .filter((m): m is SupplierMentionContact => Boolean(m) && typeof m === 'object')
      .map((m) => ({ name: String(m.name ?? '').trim(), openId: String(m.openId ?? '').trim() }))
      .filter((m) => m.openId.length > 0),
  }
}
