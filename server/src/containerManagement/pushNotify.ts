/** 站点账户的流转通知配置：与前端 src/containerManagement/pushNotify.ts 同构 */
export type MentionContact = { name: string; openId: string }

export type AccountPushNotify = {
  enabled: boolean
  chatId: string
  mentions: MentionContact[]
}

export const DEFAULT_ACCOUNT_PUSH_NOTIFY: AccountPushNotify = {
  enabled: false,
  chatId: '',
  mentions: [],
}

/** 入库与出库都走这里：jsonb 里可能是任何形状，一律归一化 */
export function normalizeAccountPushNotify(raw: unknown): AccountPushNotify {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const mentions = Array.isArray(obj.mentions) ? obj.mentions : []
  return {
    enabled: obj.enabled === true,
    chatId: typeof obj.chatId === 'string' ? obj.chatId.trim() : '',
    mentions: mentions
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({
        name: String(item.name ?? '').trim(),
        openId: String(item.openId ?? '').trim(),
      }))
      .filter((item) => item.openId.length > 0),
  }
}
