import { ZKT_ATTENDANCE_BASE_URL } from './constants'

const TOKEN_PATH = '/jwt-api-token-auth/'
/** 解不出 exp 时的兜底有效期 */
const FALLBACK_TTL_MS = 60 * 60 * 1000
/** 提前于 exp 失效，避免边界上用到临期 token */
const EXPIRY_SAFETY_MARGIN_MS = 10 * 60 * 1000

type ZktCredentials = {
  username: string
  password: string
}

type CachedToken = {
  token: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()

function cacheKey(credentials: ZktCredentials): string {
  return credentials.username
}

function normalizeBaseUrl(): string {
  return ZKT_ATTENDANCE_BASE_URL.replace(/\/+$/, '')
}

export function zktAuthHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/json',
    Authorization: `JWT ${token}`,
  }
}

/** JWT payload 自带 exp（秒），实测有效期 7 天 */
function readJwtExpiryMs(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch {
    return null
  }
}

function parseTokenError(status: number, text: string): string {
  try {
    const json = JSON.parse(text) as Record<string, unknown>
    const nonFieldErrors = json.non_field_errors
    if (Array.isArray(nonFieldErrors) && nonFieldErrors.length) {
      return String(nonFieldErrors[0]).trim()
    }
    if (typeof json.detail === 'string' && json.detail.trim()) {
      return json.detail.trim()
    }
  } catch {
    /* ignore */
  }
  return text.trim().slice(0, 200) || `HTTP ${status}`
}

async function fetchZktToken(credentials: ZktCredentials): Promise<string> {
  const res = await fetch(`${normalizeBaseUrl()}${TOKEN_PATH}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }),
  })
  const text = await res.text()

  if (!res.ok) {
    throw new Error(`ZKT 取 token 失败：${parseTokenError(res.status, text)}`)
  }

  let token: string
  try {
    token = String((JSON.parse(text) as { token?: unknown }).token ?? '').trim()
  } catch {
    throw new Error('ZKT 取 token 失败：响应不是合法 JSON')
  }
  if (!token) {
    throw new Error('ZKT 取 token 失败：响应中没有 token')
  }
  return token
}

export async function getZktToken(credentials: ZktCredentials, forceRefresh = false): Promise<string> {
  const key = cacheKey(credentials)
  if (!forceRefresh) {
    const cached = tokenCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token
    }
  }

  const token = await fetchZktToken(credentials)
  const expiry = readJwtExpiryMs(token)
  tokenCache.set(key, {
    token,
    expiresAt: expiry != null ? expiry - EXPIRY_SAFETY_MARGIN_MS : Date.now() + FALLBACK_TTL_MS,
  })
  return token
}

export function invalidateZktToken(credentials: ZktCredentials): void {
  tokenCache.delete(cacheKey(credentials))
}
