import { backendFetch } from './httpClient'
import type { AuthUser, RegionOption } from './authApi'

export type PermissionDefinition = {
  key: string
  type: 'menu' | 'button'
  label: string
  description?: string
  menuKey?: string
  sortOrder: number
}

export type AdminUser = AuthUser & {
  permissions: string[]
}

type ApiErrorBody = {
  error?: string
}

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await backendFetch(`/api/admin/users${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = await parseJson<T & ApiErrorBody>(res)
  if (!res.ok) {
    throw new Error(body.error ?? '请求失败')
  }
  return body
}

export async function fetchAdminRegions(): Promise<RegionOption[]> {
  const body = await adminFetch<{ regions: RegionOption[] }>('/regions')
  return body.regions
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const body = await adminFetch<{ users: AdminUser[] }>('/')
  return body.users
}

export async function fetchAdminPermissions(): Promise<PermissionDefinition[]> {
  const body = await adminFetch<{ permissions: PermissionDefinition[] }>('/permissions')
  return body.permissions
}

export async function createAdminUser(payload: {
  regionCode: string
  username: string
  password: string
  displayName?: string
  permissionKeys: string[]
}): Promise<AdminUser> {
  const body = await adminFetch<{ user: AdminUser }>('/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return body.user
}

export async function updateAdminUser(
  id: string,
  payload: { displayName?: string; isActive?: boolean; password?: string },
): Promise<AdminUser> {
  const body = await adminFetch<{ user: AdminUser }>(`/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return body.user
}

export async function deleteAdminUser(id: string): Promise<void> {
  await adminFetch<{ ok: boolean }>(`/${id}`, { method: 'DELETE' })
}

export async function updateAdminUserPermissions(id: string, permissionKeys: string[]): Promise<string[]> {
  const body = await adminFetch<{ permissions: string[] }>(`/${id}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissionKeys }),
  })
  return body.permissions
}
