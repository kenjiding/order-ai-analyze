import { backendFetch } from './httpClient'

export type UserPreferencePayload<T> = { value: T | null; updatedAt: string | null }

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    type Wire = { ok?: boolean; data?: T; error?: string }
    const json = (await res.json()) as Wire
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '请求失败' }
  } catch {
    return { ok: false, error: `无法访问后端 (${path})` }
  }
}

/** 读取当前用户的某个偏好；从未保存过时 value 为 null */
export async function getUserPreference<T>(
  key: string,
): Promise<{ ok: true; data: UserPreferencePayload<T> } | { ok: false; error: string }> {
  return apiFetch<UserPreferencePayload<T>>(`/api/user-preferences/${encodeURIComponent(key)}`, {
    method: 'GET',
  })
}

/** 保存当前用户的某个偏好（整体覆盖 value） */
export async function putUserPreference<T>(
  key: string,
  value: T,
): Promise<{ ok: true; data: UserPreferencePayload<T> } | { ok: false; error: string }> {
  return apiFetch<UserPreferencePayload<T>>(`/api/user-preferences/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  })
}
