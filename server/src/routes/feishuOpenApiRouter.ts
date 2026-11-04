import { Router, type Request, type Response, type NextFunction } from 'express'
import { findActiveFeishuOpenApiKeyByToken, touchFeishuOpenApiKeyLastUsed } from '../feishu/feishuOpenApiKeyRepository'
import { sendFeishuOpenApiMessage, type FeishuOpenApiTarget } from '../feishu/sendFeishuOpenApiMessage'
import type { SupplierMentionContact } from '../feishu/feishuMentionHelpers'

/**
 * 飞书推送开放 API：外部系统凭 API Key 调用，推送到个人（open_id）或群（webhookUrl / chatId），
 * 实际仍转发本项目自己配置的飞书应用凭证——不是多租户。鉴权与 requireAuth（用户登录）无关，
 * 挂法同 vendorPortalRouter / feishuEventRouter：不走 requireAuth，自成一套校验。
 */
export const feishuOpenApiRouter = Router()

type OpenApiRequest = Request & { feishuOpenApiKeyId?: string }

function readApiKeyFromRequest(req: Request): string | null {
  const headerKey = req.headers['x-api-key']
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim()
  const authHeader = String(req.headers.authorization ?? '').trim()
  if (authHeader.toLowerCase().startsWith('bearer ')) return authHeader.slice(7).trim()
  return null
}

async function requireFeishuOpenApiKey(req: OpenApiRequest, res: Response, next: NextFunction): Promise<void> {
  const token = readApiKeyFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 API Key（X-API-Key header 或 Authorization: Bearer）' })
    return
  }
  const key = await findActiveFeishuOpenApiKeyByToken(token)
  if (!key) {
    res.status(401).json({ ok: false, error: 'API Key 无效或已被禁用' })
    return
  }
  req.feishuOpenApiKeyId = key.id
  void touchFeishuOpenApiKeyLastUsed(key.id)
  next()
}

// ─── 极简内存限流：60 次/分钟/key（代码库无现成 rate-limit 中间件，同 vendorPortalRouter 的做法） ──
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60_000
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimit(req: OpenApiRequest, res: Response, next: NextFunction): void {
  const now = Date.now()
  const key = req.feishuOpenApiKeyId ?? 'unknown'
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    if (rateBuckets.size > 10_000) {
      for (const [k, v] of rateBuckets) {
        if (v.resetAt <= now) rateBuckets.delete(k)
      }
    }
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    next()
    return
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) {
    res.status(429).json({ ok: false, error: '请求过于频繁，请稍后重试' })
    return
  }
  next()
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
}

function parseTarget(raw: unknown): FeishuOpenApiTarget | null {
  const obj = asRecord(raw)
  if (!obj) return null
  if (obj.type === 'open_id') {
    return typeof obj.openId === 'string' && obj.openId.trim() ? { type: 'open_id', openId: obj.openId.trim() } : null
  }
  if (obj.type === 'chat') {
    return {
      type: 'chat',
      chatId: typeof obj.chatId === 'string' ? obj.chatId : undefined,
      webhookUrl: typeof obj.webhookUrl === 'string' ? obj.webhookUrl : undefined,
      signingSecret: typeof obj.signingSecret === 'string' ? obj.signingSecret : undefined,
    }
  }
  return null
}

function parseMentions(raw: unknown): SupplierMentionContact[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      openId: typeof item.openId === 'string' ? item.openId.trim() : '',
      name: typeof item.name === 'string' ? item.name.trim() : '',
    }))
    .filter((item) => item.openId)
}

feishuOpenApiRouter.post(
  '/messages',
  requireFeishuOpenApiKey,
  rateLimit,
  async (req: Request, res: Response) => {
    const body = asRecord(req.body) ?? {}
    const target = parseTarget(body.target)
    if (!target) {
      res.status(400).json({ ok: false, error: 'target 不合法：需要 { type: "open_id", openId } 或 { type: "chat", chatId/webhookUrl }' })
      return
    }
    const msgType = body.msgType
    if (msgType !== 'interactive' && msgType !== 'text') {
      res.status(400).json({ ok: false, error: 'msgType 只支持 "interactive"（卡片） 或 "text"（文本）' })
      return
    }
    const content = asRecord(body.content)
    if (!content) {
      res.status(400).json({ ok: false, error: '缺少 content（飞书原生的卡片 2.0 JSON 或文本消息 JSON）' })
      return
    }
    const mentions = parseMentions(body.mentions)

    const result = await sendFeishuOpenApiMessage({ target, msgType, content, mentions })
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error })
      return
    }
    res.json({ ok: true, messageId: result.messageId, chatId: result.chatId })
  },
)
