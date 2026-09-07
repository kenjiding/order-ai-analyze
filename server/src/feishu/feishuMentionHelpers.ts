export type SupplierMentionContact = { name: string; openId: string }

/** 供应商配置里 mentionOpenIds 花名册，勾选「是否 @ 相关人员」时全部 @ 上（未勾选则不 @ 任何人） */
export function pickMentions(
  mentionOpenIds: SupplierMentionContact[] | null | undefined,
  enabled: boolean,
): SupplierMentionContact[] {
  if (!enabled) return []
  return (mentionOpenIds ?? []).filter((m) => m.openId)
}

/**
 * 自定义机器人卡片里的 @ 语法（lark_md 内嵌 `<at id="ou_xxx"></at>`），多个联系人依次拼接，拼在卡片正文最前面。
 * @see https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */
export function buildMentionLarkMd(mentions: SupplierMentionContact[] | null | undefined): string {
  const list = (mentions ?? []).filter((m) => m?.openId)
  if (!list.length) return ''
  return list.map((m) => `<at id="${m.openId}"></at>`).join(' ')
}

/**
 * 「重要提醒」独立卡片：紧接着数据卡片单独发一条，内容就是用户填写的原文，不加任何标题。
 * 勾选「@ 相关人员」时 @ 人跟在提醒后面（此时数据卡片不再 @，由调用方负责不传 mentions）。
 */
export function buildImportantNoticeCard(
  importantNotice: string,
  mentions: SupplierMentionContact[] | null | undefined,
): Record<string, unknown> {
  const at = buildMentionLarkMd(mentions)
  const content = at ? `${importantNotice.trim()}\n${at}` : importantNotice.trim()
  return {
    schema: '2.0',
    body: { direction: 'vertical', elements: [{ tag: 'markdown', content }] },
  }
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
