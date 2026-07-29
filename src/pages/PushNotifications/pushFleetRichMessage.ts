import type { PushApiScope } from '../../permissions/pushNotificationAccess'
import type { FeishuPushTestFail, FeishuPushTestOk } from './feishuWebhookTestApi'
import { postFeishuPushRichMessage } from './feishuWebhookTestApi'

export async function pushFleetRichMessage(payload: {
  pushScope: PushApiScope
  webhookUrl: string
  signingSecret?: string
  content: string
  images: string[]
  /** 勾选「@ 相关人员」时传该供应商花名册第 1 位联系人的 open_id */
  mentionOpenId?: string
}): Promise<FeishuPushTestOk | FeishuPushTestFail> {
  const content = payload.content.trim()
  const images = payload.images.filter((u) => u.trim().length > 0)
  if (!content && images.length === 0) {
    return { ok: false, error: '文案与图片均为空' }
  }

  return postFeishuPushRichMessage({
    pushScope: payload.pushScope,
    webhookUrl: payload.webhookUrl,
    signingSecret: payload.signingSecret,
    content,
    images,
    mentionOpenId: payload.mentionOpenId,
  })
}
