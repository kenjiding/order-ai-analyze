import { backendFetch } from './httpClient'

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
  const res = await backendFetch('/api/auth/me')
  if (res.status === 401) return null
  if (!res.ok) {
    const body = await parseJson<ApiErrorBody>(res)
    throw new Error(body.error ?? '获取登录状态失败')
  }
  return parseJson<AuthSession>(res)
}

export async function fetchLogin(username: string, password: string): Promise<AuthSession> {
  let res: Response
  try {
    res = await backendFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    throw new Error('网络异常，请检查连接后重试')
  }

  let body: AuthSession & ApiErrorBody
  try {
    body = await parseJson<AuthSession & ApiErrorBody>(res)
  } catch {
    throw new Error(res.ok ? '登录响应解析失败' : '登录失败，请稍后重试')
  }

  if (!res.ok) {
    throw new Error(body.error ?? '登录失败')
  }
  return { user: body.user, permissions: body.permissions }
}

export async function fetchLogout(): Promise<void> {
  await backendFetch('/api/auth/logout', {
    method: 'POST',
  })
}
