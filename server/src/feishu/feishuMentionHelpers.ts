export type SupplierMentionContact = { name: string; openId: string }

/** 供应商配置里 mentionOpenIds 花名册的第 1 位，即"要 @ 的那个人" */
export function pickPrimaryMention(
  mentionOpenIds: SupplierMentionContact[] | null | undefined,
): SupplierMentionContact | null {
  return mentionOpenIds?.[0] ?? null
}

/**
 * 自定义机器人卡片里的 @ 语法（lark_md 内嵌 `<at id="ou_xxx"></at>`），拼在卡片正文最前面。
 * @see https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */
export function buildMentionLarkMd(mention: SupplierMentionContact | null | undefined): string {
  if (!mention?.openId) return ''
  return `<at id="${mention.openId}"></at>`
}

/** 解析供应商配置存储的 mentionOpenIds jsonb，过滤非法项 */
export function parseSupplierMentionContacts(raw: unknown): SupplierMentionContact[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      openId: typeof item.openId === 'string' ? item.openId.trim() : '',
    }))
    .filter((item) => item.openId.length > 0)
}
