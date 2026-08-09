import { Router } from 'express'
import { CardActionHandler, adaptExpress } from '@larksuiteoapi/node-sdk'
import { getFeishuVerificationToken } from '../feishuServerEnv'
import { insertFeishuCardClickEvent } from '../feishu/feishuCardClickEventRepository'

function stringValue(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * card JSON 2.0 的 card.action.trigger 事件实际结构（SDK 自带的 InteractiveCardActionEvent
 * 类型是旧版 schema 1.0 回调的扁平结构 open_id/open_message_id，对不上，故自定义）。
 * @see https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/card-callback-communication/callback-return-value
 */
interface CardActionTriggerEvent {
  operator?: { open_id?: string; user_id?: string; tenant_key?: string }
  context?: { open_message_id?: string; open_chat_id?: string }
  action?: { value?: Record<string, unknown>; tag?: string; option?: string }
}

/**
 * 飞书卡片按钮点击回调（button 同时挂 open_url + callback behavior，跳转不受影响，
 * 服务端异步收到这个回调）。用官方 SDK 的 CardActionHandler：验签、URL 校验握手（url_verification
 * challenge）都由 SDK 处理，不用自己写。
 * 不挂 requireAuth：请求方是飞书服务器，不带我方登录态。
 * @see https://github.com/larksuite/node-sdk （README「消息卡片」一节）
 */
const cardActionHandler = new CardActionHandler(
  { verificationToken: getFeishuVerificationToken() ?? '' },
  async (data: CardActionTriggerEvent) => {
    const openId = data.operator?.open_id
    const messageId = data.context?.open_message_id
    const value = (data.action?.value ?? {}) as Record<string, unknown>
    const pushType = stringValue(value.pushType)
    const actionType = stringValue(value.actionType)
    const supplierConfigId = stringValue(value.supplierConfigId) || null

    if (!openId || !messageId || !pushType || !actionType) {
      console.warn('[feishu-event/card-callback] 回调缺少必要字段，跳过落库', { openId, messageId, pushType, actionType })
      return undefined
    }

    try {
      await insertFeishuCardClickEvent({ messageId, supplierConfigId, openId, actionType, pushType })
    } catch (err) {
      // 落库失败不影响响应飞书（按钮跳转已经独立完成，不依赖这个回调）
      console.error('[feishu-event/card-callback] 落库失败:', err)
    }

    // 不返回新卡片内容，飞书侧卡片保持原样，只是我们记录了这次点击
    return undefined
  },
)

export const feishuEventRouter = Router()
feishuEventRouter.post('/card-callback', adaptExpress(cardActionHandler, { autoChallenge: true }))
