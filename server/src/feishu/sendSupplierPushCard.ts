import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { getFeishuTenantAccessToken } from '../feishuServerEnv'
import { sendFeishuAppMessage } from './feishuAppMessage'

async function pushCardToWebhook(
  webhookUrl: string,
  signingSecret: string | null | undefined,
  card: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string }> {
  let webhookHref: string
  try {
    webhookHref = parseSafeWebhookUrl(webhookUrl).href
  } catch {
    return { ok: false, reason: 'webhookUrl 不合法' }
  }
  const payload: Record<string, unknown> = { msg_type: 'interactive', card }
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
    return { ok: false, reason: `飞书返回 code=${String(data.code)}` }
  } catch (err) {
    const cause = err instanceof Error ? (err.cause as { code?: string } | undefined)?.code : undefined
    return { ok: false, reason: `网络错误(${cause ?? (err instanceof Error ? err.message : String(err))})` }
  }
}

async function pushCardViaAppBot(
  chatId: string,
  card: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string; messageId?: string }> {
  const tenantRes = await getFeishuTenantAccessToken()
  if (!tenantRes.ok) {
    return {
      ok: false,
      reason:
        tenantRes.reason === 'not_configured'
          ? '服务器未配置飞书开放接口凭证（FEISHU_APP_ID / FEISHU_APP_SECRET），无法走应用机器人通道'
          : `获取应用机器人凭证失败(${tenantRes.error})`,
    }
  }
  const sendRes = await sendFeishuAppMessage(tenantRes.token, chatId, 'interactive', card)
  if (!sendRes.ok) return { ok: false, reason: sendRes.error }
  return { ok: true, messageId: sendRes.messageId }
}

/**
 * 供应商卡片发送：webhookUrl / chatId 二选一，webhookUrl 优先（历史配置默认走法不变，
 * 且信息更全——支持签名校验）；都未配置时视为不可推送。
 * 出仓告警 / 24H 派签告警 / 催派推送 / 工单推送 / 派送中通知 共用，避免各自重复实现
 * webhook 发送逻辑（曾经 4 份 pushCardToWebhook 完全相同代码），也让 chatId-only 的
 * 供应商配置真正可用——此前只在"供应商配置"表单里放行保存，实际 4 类定时推送从不消费 chatId。
 */
export async function sendSupplierPushCard(
  target: { webhookUrl?: string | null; signingSecret?: string | null; chatId?: string | null },
  card: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string; messageId?: string; chatId?: string }> {
  const webhookUrl = target.webhookUrl?.trim()
  if (webhookUrl) {
    // webhook 通道飞书不返回可查询的 message_id，无法记录已读/关联点击
    return pushCardToWebhook(webhookUrl, target.signingSecret, card)
  }
  const chatId = target.chatId?.trim()
  if (chatId) {
    const res = await pushCardViaAppBot(chatId, card)
    return { ...res, chatId: res.ok ? chatId : undefined }
  }
  return { ok: false, reason: '未配置 Webhook 或飞书群 Chat ID' }
}
