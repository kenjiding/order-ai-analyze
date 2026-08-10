import { backendFetch } from '../../api/httpClient'
import type { PushClickEvent, PushEngagementRow, PushReadStatus } from './pushEngagementTypes'

function backendUnreachableMessage(path: string): string {
  return `无法访问后端 (${path})。请确认已运行 server（如 pnpm dev:server）或检查 VITE_API_BASE。`
}

export type PushEngagementFilters = {
  startDate?: string
  endDate?: string
  pushLabel?: string
  supplierConfigId?: string
  regionCode?: string
}

export async function fetchPushEngagementList(
  filters: PushEngagementFilters,
): Promise<{ ok: true; data: PushEngagementRow[] } | { ok: false; error: string }> {
  const qs = new URLSearchParams()
  if (filters.startDate) qs.set('startDate', filters.startDate)
  if (filters.endDate) qs.set('endDate', filters.endDate)
  if (filters.pushLabel) qs.set('pushLabel', filters.pushLabel)
  if (filters.supplierConfigId) qs.set('supplierConfigId', filters.supplierConfigId)
  if (filters.regionCode) qs.set('regionCode', filters.regionCode)
  const path = `/api/feishu-webhook/push-engagement?${qs.toString()}`
  try {
    const res = await backendFetch(path)
    const parsed = (await res.json()) as { ok?: boolean; data?: PushEngagementRow[]; error?: string }
    if (parsed?.ok === true && Array.isArray(parsed.data)) {
      return { ok: true, data: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '获取推送记录失败。' }
  } catch {
    return { ok: false, error: backendUnreachableMessage(path) }
  }
}

/** 已读/未读名单（飞书仅允许查发送后 7 天内的消息） */
export async function fetchPushMessageReadStatus(
  pushMessageId: string,
): Promise<{ ok: true; data: PushReadStatus } | { ok: false; error: string }> {
  const path = `/api/feishu-webhook/push-messages/${encodeURIComponent(pushMessageId)}/read-status`
  try {
    const res = await backendFetch(path)
    const parsed = (await res.json()) as { ok?: boolean; data?: PushReadStatus; error?: string }
    if (parsed?.ok === true && parsed.data) {
      return { ok: true, data: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '查询已读状态失败。' }
  } catch {
    return { ok: false, error: backendUnreachableMessage(path) }
  }
}

/** 卡片按钮点击名单：不受 7 天限制（我方落库） */
export async function fetchPushMessageClickEvents(
  pushMessageId: string,
): Promise<{ ok: true; data: PushClickEvent[] } | { ok: false; error: string }> {
  const path = `/api/feishu-webhook/push-messages/${encodeURIComponent(pushMessageId)}/click-events`
  try {
    const res = await backendFetch(path)
    const parsed = (await res.json()) as { ok?: boolean; data?: PushClickEvent[]; error?: string }
    if (parsed?.ok === true && Array.isArray(parsed.data)) {
      return { ok: true, data: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '查询点击记录失败。' }
  } catch {
    return { ok: false, error: backendUnreachableMessage(path) }
  }
}

/** 批量已读/未读名单：一次请求查询多条消息，避免展开一个日期行时逐条发请求 */
export async function fetchPushMessageReadStatusBatch(
  pushMessageIds: string[],
): Promise<{ ok: true; data: Record<string, PushReadStatus> } | { ok: false; error: string }> {
  if (pushMessageIds.length === 0) return { ok: true, data: {} }
  const path = `/api/feishu-webhook/push-messages/read-status?ids=${encodeURIComponent(pushMessageIds.join(','))}`
  try {
    const res = await backendFetch(path)
    const parsed = (await res.json()) as { ok?: boolean; data?: Record<string, PushReadStatus>; error?: string }
    if (parsed?.ok === true && parsed.data) {
      return { ok: true, data: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '查询已读状态失败。' }
  } catch {
    return { ok: false, error: backendUnreachableMessage(path) }
  }
}

/** 批量点击记录：一次请求查询多条消息，避免展开一个日期行时逐条发请求 */
export async function fetchPushMessageClickEventsBatch(
  pushMessageIds: string[],
): Promise<{ ok: true; data: Record<string, PushClickEvent[]> } | { ok: false; error: string }> {
  if (pushMessageIds.length === 0) return { ok: true, data: {} }
  const path = `/api/feishu-webhook/push-messages/click-events?ids=${encodeURIComponent(pushMessageIds.join(','))}`
  try {
    const res = await backendFetch(path)
    const parsed = (await res.json()) as { ok?: boolean; data?: Record<string, PushClickEvent[]>; error?: string }
    if (parsed?.ok === true && parsed.data) {
      return { ok: true, data: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '查询点击记录失败。' }
  } catch {
    return { ok: false, error: backendUnreachableMessage(path) }
  }
}
