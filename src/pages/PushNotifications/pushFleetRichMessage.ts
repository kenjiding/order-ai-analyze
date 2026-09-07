import { i18n } from '../../i18n/index'
import type { PushApiScope } from '../../permissions/pushNotificationAccess'
import type { FeishuPushTestFail, FeishuPushTestOk } from './feishuWebhookTestApi'
import { postFeishuPushRichMessage, postFeishuPushRichMessageViaAppBot } from './feishuWebhookTestApi'

export async function pushFleetRichMessage(payload: {
  pushScope: PushApiScope
  webhookUrl: string
  signingSecret?: string
  /** 供应商配置了 chatId 时，改走自建应用机器人通道（支持已读查询），忽略 webhookUrl */
  chatId?: string
  supplierConfigId?: string
  pushLabel?: string
  content: string
  images: string[]
  /** 勾选「@ 相关人员」时传该供应商花名册里选中的全部联系人 open_id */
  mentionOpenIds?: string[]
}): Promise<FeishuPushTestOk | FeishuPushTestFail> {
  const content = payload.content.trim()
  const images = payload.images.filter((u) => u.trim().length > 0)
  if (!content && images.length === 0) {
    return {
      ok: false,
      error: String(i18n.t('api.emptyContentAndImages', { ns: 'pushNotifications' })),
    }
  }

  if (payload.chatId?.trim()) {
    return postFeishuPushRichMessageViaAppBot({
      pushScope: payload.pushScope,
      supplierConfigId: payload.supplierConfigId,
      chatId: payload.chatId,
      pushLabel: payload.pushLabel,
      content,
      images,
      mentionOpenIds: payload.mentionOpenIds,
    })
  }

  return postFeishuPushRichMessage({
    pushScope: payload.pushScope,
    webhookUrl: payload.webhookUrl,
    signingSecret: payload.signingSecret,
    content,
    images,
    mentionOpenIds: payload.mentionOpenIds,
  })
}
