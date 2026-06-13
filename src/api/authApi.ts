import { getApiBaseUrl } from '../utils/apiBaseUrl'

export type UserRole = 'super_admin' | 'user'

export type RegionOption = {
  code: string
  name: string
  nameEn: string
  sortOrder: number
}

export type AuthUser = {
  id: string
  username: string
  displayName: string | null
  role: UserRole
  isActive: boolean
  regionCode: string | null
  regionName: string | null
}

export type AuthSession = {
  user: AuthUser
  permissions: string[]
}

type ApiErrorBody = {
  error?: string
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T
  return data
}

export async function fetchAuthMe(): Promise<AuthSession | null> {
  const res = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
    credentials: 'include',
  })
  if (res.status === 401) return null
  if (!res.ok) {
    const body = await parseJson<ApiErrorBody>(res)
    throw new Error(body.error ?? '获取登录状态失败')
  }
  return parseJson<AuthSession>(res)
}

export async function fetchLogin(username: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await parseJson<AuthSession & ApiErrorBody>(res)
  if (!res.ok) {
    throw new Error(body.error ?? '登录失败')
  }
  return { user: body.user, permissions: body.permissions }
}

export async function fetchLogout(): Promise<void> {
  await fetch(`${getApiBaseUrl()}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })
}
