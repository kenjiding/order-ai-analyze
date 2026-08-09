import { fetchFeishuJson } from './feishu/feishuHttpClient'

/** @see https://open.feishu.cn/document/ukTMukTMukTM/ukDNz4SO0MjL5QzM/auth-v3/auth/tenant_access_token_internal */
const FEISHU_TENANT_TOKEN_INTERNAL_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'

function normalizeSecret(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const t = raw.trim()
  return t !== '' ? t : undefined
}

function readAppId(): string | undefined {
  const appIdRaw = process.env.FEISHU_APP_ID
  return typeof appIdRaw === 'string' && appIdRaw.trim() !== '' ? appIdRaw.trim() : undefined
}

/**
 * 校验飞书事件/卡片回调请求确实来自本应用：开发者后台「事件与回调」页面的 Verification Token。
 * @see https://open.feishu.cn/document/uYjL24iN/uYzMxEjL2MTMx4iNzETM
 */
export function getFeishuVerificationToken(): string | undefined {
  const raw = process.env.FEISHU_VERIFICATION_TOKEN
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

type TokenCache = {
  token: string
  expiresAtMs: number
}

let tenantTokenCache: TokenCache | null = null
let tenantTokenInflight: Promise<string> | null = null

async function fetchTenantAccessTokenFromApp(appId: string, appSecret: string): Promise<{ token: string; expireSec: number }> {
  const result = await fetchFeishuJson(FEISHU_TENANT_TOKEN_INTERNAL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  if (!result.ok) {
    throw new Error(result.error)
  }

  const body = result.json
  const obj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  const code = obj && typeof obj.code === 'number' ? obj.code : NaN
  if (code !== 0) {
    const msg = obj && typeof obj.msg === 'string' ? obj.msg : 'tenant_access_token 获取失败'
    const err = new Error(msg)
    ;(err as Error & { feishuBody?: unknown }).feishuBody = body
    throw err
  }

  const token = obj && typeof obj.tenant_access_token === 'string' ? obj.tenant_access_token.trim() : ''
  if (!token) {
    const err = new Error('飞书未返回 tenant_access_token')
    ;(err as Error & { feishuBody?: unknown }).feishuBody = body
    throw err
  }

  const expireRaw = obj && typeof obj.expire === 'number' ? obj.expire : 7200
  const expireSec = Number.isFinite(expireRaw) && expireRaw > 0 ? expireRaw : 7200

  return { token, expireSec }
}

/**
 * 通过 `tenant_access_token/internal` 换取用于 `im/v1/images` 的 token（内存缓存，临近过期刷新）。
 */
export async function getFeishuTenantAccessToken(): Promise<
  | { ok: true; token: string }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'auth_failed'; error: string; feishuAuth?: unknown }
> {
  const appId = readAppId()
  const appSecret = normalizeSecret(process.env.FEISHU_APP_SECRET)

  if (!appId || !appSecret) {
    return { ok: false, reason: 'not_configured' }
  }

  const now = Date.now()
  if (tenantTokenCache && now < tenantTokenCache.expiresAtMs) {
    return { ok: true, token: tenantTokenCache.token }
  }

  if (tenantTokenInflight) {
    try {
      const token = await tenantTokenInflight
      return { ok: true, token }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const feishuAuth = e instanceof Error ? (e as Error & { feishuBody?: unknown }).feishuBody : undefined
      return { ok: false, reason: 'auth_failed', error: msg, feishuAuth }
    }
  }

  tenantTokenInflight = (async () => {
    try {
      const { token, expireSec } = await fetchTenantAccessTokenFromApp(appId, appSecret)
      const skewSec = 120
      const ttlMs = Math.max(60, expireSec - skewSec) * 1000
      tenantTokenCache = { token, expiresAtMs: Date.now() + ttlMs }
      return token
    } finally {
      tenantTokenInflight = null
    }
  })()

  try {
    const token = await tenantTokenInflight
    return { ok: true, token }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const feishuAuth = e instanceof Error ? (e as Error & { feishuBody?: unknown }).feishuBody : undefined
    return { ok: false, reason: 'auth_failed', error: msg, feishuAuth }
  }
}
