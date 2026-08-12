import { backendFetch } from '../../api/httpClient'
import type { PushClickEvent, PushEngagementRow, PushReadStatus } from './pushEngagementTypes'

function backendUnreachableMessage(path: string): string {
  return `无法访问后端 (${path})。请确认已运行 server（如 pnpm dev:server）或检查 VITE_API_BASE。`
}

/**
 * 后端所有失败分支都返回 JSON，解析不出 JSON 说明响应根本不是后端给的——
 * 而是 Nginx / Express 默认错误页（504 超时、502 后端不可达、404 路由不存在）。
 * 必须把状态码带出来：之前统一吞成"请确认已运行 server"，线上排查时会被引到完全错误的方向。
 */
async function parseJson<T>(res: Response, path: string): Promise<{ ok: true; json: T } | { ok: false; error: string }> {
  try {
    return { ok: true, json: (await res.json()) as T }
  } catch {
    const hint = res.status === 504 ? '接口超时' : res.status === 502 ? '后端不可达' : res.status === 404 ? '接口不存在' : '响应不是 JSON'
    return { ok: false, error: `请求失败：HTTP ${res.status}（${hint}） — ${path}` }
  }
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
    const body = await parseJson<{ ok?: boolean; data?: PushEngagementRow[]; error?: string }>(res, path)
    if (!body.ok) return body
    const parsed = body.json
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
    const body = await parseJson<{ ok?: boolean; data?: PushReadStatus; error?: string }>(res, path)
    if (!body.ok) return body
    const parsed = body.json
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
    const body = await parseJson<{ ok?: boolean; data?: PushClickEvent[]; error?: string }>(res, path)
    if (!body.ok) return body
    const parsed = body.json
    if (parsed?.ok === true && Array.isArray(parsed.data)) {
      return { ok: true, data: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '查询点击记录失败。' }
  } catch {
    return { ok: false, error: backendUnreachableMessage(path) }
  }
}

/**
 * 批量已读/未读名单：一次请求查询一个「推送类型」分组下的消息。
 * 后端按条降级——查到的进 data、失败的进 errors，两者都要用上，
 * 否则「一部分查到了」会被当成整体失败。
 */
export async function fetchPushMessageReadStatusBatch(
  pushMessageIds: string[],
): Promise<
  { ok: true; data: Record<string, PushReadStatus>; errors: Record<string, string> } | { ok: false; error: string }
> {
  if (pushMessageIds.length === 0) return { ok: true, data: {}, errors: {} }
  const path = `/api/feishu-webhook/push-messages/read-status?ids=${encodeURIComponent(pushMessageIds.join(','))}`
  try {
    const res = await backendFetch(path)
    const body = await parseJson<{
      ok?: boolean
      data?: Record<string, PushReadStatus>
      errors?: Record<string, string>
      error?: string
    }>(res, path)
    if (!body.ok) return body
    const parsed = body.json
    if (parsed?.ok === true && parsed.data) {
      return { ok: true, data: parsed.data, errors: parsed.errors ?? {} }
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
    const body = await parseJson<{ ok?: boolean; data?: Record<string, PushClickEvent[]>; error?: string }>(res, path)
    if (!body.ok) return body
    const parsed = body.json
    if (parsed?.ok === true && parsed.data) {
      return { ok: true, data: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '查询点击记录失败。' }
  } catch {
    return { ok: false, error: backendUnreachableMessage(path) }
  }
}
