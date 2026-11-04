import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { getFeishuTenantAccessToken } from '../feishuServerEnv'
import { sendFeishuAppMessage } from './feishuAppMessage'
import { buildMentionLarkMd, buildMentionText, type SupplierMentionContact } from './feishuMentionHelpers'

export type FeishuOpenApiTarget =
  | { type: 'open_id'; openId: string }
  | { type: 'chat'; chatId?: string; webhookUrl?: string; signingSecret?: string }

export type FeishuOpenApiMessageParams = {
  target: FeishuOpenApiTarget
  msgType: 'interactive' | 'text'
  content: Record<string, unknown>
  /** 仅 target.type === 'chat' 时生效；个人私聊场景忽略 */
  mentions?: SupplierMentionContact[] | null
}

export type FeishuOpenApiMessageResult =
  | { ok: true; messageId?: string; chatId?: string }
  | { ok: false; status: 400 | 502; error: string }

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
}

/** 把 mentions 拼进 content：卡片在 body.elements 末尾追加一个 markdown 元素；文本在 text 前面拼 `<at>` 前缀 */
function applyMentions(
  msgType: 'interactive' | 'text',
  content: Record<string, unknown>,
  mentions: SupplierMentionContact[] | null | undefined,
): { ok: true; content: Record<string, unknown> } | { ok: false; error: string } {
  if (!mentions || mentions.length === 0) return { ok: true, content }

  if (msgType === 'text') {
    const prefix = buildMentionText(mentions)
    const text = typeof content.text === 'string' ? content.text : ''
    return { ok: true, content: { ...content, text: prefix ? `${prefix} ${text}` : text } }
  }

  const body = asRecord(content.body)
  const elements = body && Array.isArray(body.elements) ? body.elements : null
  if (!elements) {
    return {
      ok: false,
      error: 'mentions 需要 content.body.elements 是数组（飞书卡片 schema 2.0 结构）；也可以自己在卡片里手写 <at id="..."></at>',
    }
  }
  const mentionLarkMd = buildMentionLarkMd(mentions)
  if (!mentionLarkMd) return { ok: true, content }
  return {
    ok: true,
    content: {
      ...content,
      body: { ...body, elements: [...elements, { tag: 'markdown', content: mentionLarkMd }] },
    },
  }
}

async function sendToWebhook(
  webhookUrl: string,
  signingSecret: string | null | undefined,
  msgType: 'interactive' | 'text',
  content: Record<string, unknown>,
): Promise<FeishuOpenApiMessageResult> {
  let webhookHref: string
  try {
    webhookHref = parseSafeWebhookUrl(webhookUrl).href
  } catch {
    return { ok: false, status: 400, error: 'webhookUrl 不合法：只能是飞书开放平台自定义机器人 webhook 地址' }
  }
  const payload: Record<string, unknown> =
    msgType === 'interactive' ? { msg_type: 'interactive', card: content } : { msg_type: 'text', content }
  if (signingSecret) {
    const timestampSec = Math.floor(Date.now() / 1000)
    payload.timestamp = String(timestampSec)
    payload.sign = computeFeishuWebhookSign(signingSecret, timestampSec)
  }
  try {
    const upstream = await fetch(webhookHref, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>
    if (upstream.ok && typeof data.code === 'number' && data.code === 0) {
      return { ok: true }
    }
    return { ok: false, status: 502, error: `飞书返回 code=${String(data.code)}` }
  } catch (err) {
    const cause = err instanceof Error ? (err.cause as { code?: string } | undefined)?.code : undefined
    return { ok: false, status: 502, error: `网络错误(${cause ?? (err instanceof Error ? err.message : String(err))})` }
  }
}

async function sendViaAppBot(
  receiveId: string,
  receiveIdType: 'chat_id' | 'open_id',
  msgType: 'interactive' | 'text',
  content: Record<string, unknown>,
): Promise<FeishuOpenApiMessageResult> {
  const tenantRes = await getFeishuTenantAccessToken()
  if (!tenantRes.ok) {
    return {
      ok: false,
      status: 502,
      error:
        tenantRes.reason === 'not_configured'
          ? '服务器未配置飞书开放接口凭证（FEISHU_APP_ID / FEISHU_APP_SECRET）'
          : `获取应用机器人凭证失败(${tenantRes.error})`,
    }
  }
  const sendRes = await sendFeishuAppMessage(tenantRes.token, receiveId, msgType, content, receiveIdType)
  if (!sendRes.ok) return { ok: false, status: 502, error: sendRes.error }
  return { ok: true, messageId: sendRes.messageId }
}

/**
 * 飞书开放推送 API 的统一发送入口：个人私聊（open_id）或群（webhookUrl 优先，否则 chatId），
 * 群场景支持按 mentions 自动拼 @人。供 server/src/routes/feishuOpenApiRouter.ts 调用。
 */
export async function sendFeishuOpenApiMessage(params: FeishuOpenApiMessageParams): Promise<FeishuOpenApiMessageResult> {
  const { target, msgType, content } = params

  if (target.type === 'open_id') {
    if (!target.openId?.trim()) return { ok: false, status: 400, error: '缺少 target.openId' }
    return sendViaAppBot(target.openId.trim(), 'open_id', msgType, content)
  }

  const withMentions = applyMentions(msgType, content, params.mentions)
  if (!withMentions.ok) return { ok: false, status: 400, error: withMentions.error }
  const finalContent = withMentions.content

  const webhookUrl = target.webhookUrl?.trim()
  if (webhookUrl) {
    return sendToWebhook(webhookUrl, target.signingSecret, msgType, finalContent)
  }
  const chatId = target.chatId?.trim()
  if (chatId) {
    const res = await sendViaAppBot(chatId, 'chat_id', msgType, finalContent)
    return res.ok ? { ...res, chatId } : res
  }
  return { ok: false, status: 400, error: '未提供 target.webhookUrl 或 target.chatId' }
}
