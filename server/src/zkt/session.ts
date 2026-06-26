import { ZKT_ATTENDANCE_BASE_URL } from './constants'

const SESSION_TTL_MS = 50 * 60 * 1000

type ZktCredentials = {
  username: string
  password: string
}

export type ZktSession = {
  cookieHeader: string
  csrfToken: string
}

type CachedSession = ZktSession & {
  expiresAt: number
}

const sessionCache = new Map<string, CachedSession>()

function cacheKey(credentials: ZktCredentials): string {
  return credentials.username
}

function normalizeBaseUrl(): string {
  return ZKT_ATTENDANCE_BASE_URL.replace(/\/+$/, '')
}

export class SimpleCookieJar {
  private readonly cookies = new Map<string, string>()

  absorb(headers: string[] | undefined): void {
    if (!headers?.length) return
    for (const header of headers) {
      const part = header.split(';', 1)[0]?.trim()
      if (!part || !part.includes('=')) continue
      const eq = part.indexOf('=')
      const name = part.slice(0, eq).trim()
      const value = part.slice(eq + 1).trim()
      if (!name) continue
      this.cookies.set(name, value)
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)
  }
}

function readSetCookieHeaders(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }
  const single = res.headers.get('set-cookie')
  return single ? [single] : []
}

async function readResponseText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function parseLoginResult(text: string): { ok: boolean; message: string } {
  try {
    const json = JSON.parse(text) as { ret?: number; message?: string }
    if (json.ret === 0) return { ok: true, message: '' }
    return { ok: false, message: json.message?.trim() || 'ZKT 登录失败' }
  } catch {
    if (resLooksLikeLoginSuccess(text)) return { ok: true, message: '' }
    return { ok: false, message: text.trim() || 'ZKT 登录失败' }
  }
}

function resLooksLikeLoginSuccess(text: string): boolean {
  const trimmed = text.trim()
  return trimmed === 'ok' || trimmed === 'success' || trimmed === '0'
}

export async function loginZkt(credentials: ZktCredentials): Promise<ZktSession> {
  const baseUrl = normalizeBaseUrl()
  const jar = new SimpleCookieJar()

  const loginPageRes = await fetch(`${baseUrl}/login/`, {
    method: 'GET',
    headers: { Accept: 'text/html,application/json' },
    redirect: 'manual',
  })
  jar.absorb(readSetCookieHeaders(loginPageRes))
  await readResponseText(loginPageRes)

  const csrfToken = jar.get('csrftoken')
  if (!csrfToken) {
    throw new Error('ZKT 登录失败：未获取到 csrftoken')
  }

  const body = new URLSearchParams({
    username: credentials.username,
    password: credentials.password,
    remember_me_admin: 'on',
    login_type: 'pwd',
  })

  const loginRes = await fetch(`${baseUrl}/login/`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${baseUrl}/login/`,
      'X-CSRFToken': csrfToken,
      Cookie: jar.header(),
    },
    body,
    redirect: 'manual',
  })
  jar.absorb(readSetCookieHeaders(loginRes))
  const loginText = await readResponseText(loginRes)

  const parsed = parseLoginResult(loginText)
  if (!parsed.ok) {
    throw new Error(parsed.message)
  }

  if (!jar.get('sessionid')) {
    throw new Error('ZKT 登录失败：未获取到 sessionid')
  }

  return {
    cookieHeader: jar.header(),
    csrfToken: jar.get('csrftoken') ?? csrfToken,
  }
}

export async function getZktSession(credentials: ZktCredentials, forceRefresh = false): Promise<ZktSession> {
  const key = cacheKey(credentials)
  if (!forceRefresh) {
    const cached = sessionCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return { cookieHeader: cached.cookieHeader, csrfToken: cached.csrfToken }
    }
  }

  const session = await loginZkt(credentials)
  sessionCache.set(key, { ...session, expiresAt: Date.now() + SESSION_TTL_MS })
  return session
}

export function invalidateZktSession(credentials: ZktCredentials): void {
  sessionCache.delete(cacheKey(credentials))
}
