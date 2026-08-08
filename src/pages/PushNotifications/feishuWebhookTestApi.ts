import { backendFetch } from '../../api/httpClient'
import type { PushApiScope } from '../../permissions/pushNotificationAccess'

/** 飞书推送链路服务端自带超时+重试（单跳约 15s×3 次），客户端超时留够余量，避免服务端还在重试时前端先放弃 */
const FEISHU_PUSH_TIMEOUT_MS = 60_000

/** 给飞书推送请求加超时：避免服务端/飞书接口卡住时前端无限等待、按钮一直转圈 */
async function backendFetchWithTimeout(path: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FEISHU_PUSH_TIMEOUT_MS)
  try {
    return await backendFetch(path, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function backendUnreachableMessage(path: string, err: unknown): string {
  if (isTimeoutError(err)) {
    return `请求超时（${FEISHU_PUSH_TIMEOUT_MS / 1000}s），飞书接口可能响应缓慢，请稍后重试。`
  }
  return `无法访问后端 (${path})。请确认已运行 server（如 pnpm dev:server）或检查 VITE_API_BASE。`
}

export type FeishuPushTestPayload = {
  pushScope: PushApiScope
  webhookUrl: string
  signingSecret?: string | undefined
  pushName: string
}

export type FeishuPushImagePayload = {
  pushScope: PushApiScope
  webhookUrl: string
  signingSecret?: string | undefined
  /** 纯 base64 或 data:image/png;base64,... */
  imageBase64: string
  /** 先发关键词/说明文案（空字符串跳过） */
  headlineText?: string
  /** 分拣效率等结构化数据；服务端若配置 DEEPSEEK_API_KEY，将生成解读文案后于图片前推送 */
  dataSnapshot?: Record<string, unknown>
}

export type FeishuPushTestOk = { ok: true; httpStatus: number; feishu: unknown }
export type FeishuPushTestFail = {
  ok: false
  httpStatus?: number
  feishu?: unknown
  error?: string
}

export type FeishuPushImageOk = {
  ok: true
  httpStatus: number
  feishu: unknown
  imageUploaded?: boolean
  aiAnalysisGenerated?: boolean
  aiAnalysisError?: string
}
export type FeishuPushImageFail = {
  ok: false
  httpStatus?: number
  feishu?: unknown
  feishuUpload?: unknown
  error?: string
}

export async function postFeishuPushTest(payload: FeishuPushTestPayload): Promise<FeishuPushTestOk | FeishuPushTestFail> {
  const path = '/api/feishu-webhook/test'
  try {
    const res = await backendFetchWithTimeout(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    type Wire = {
      ok?: boolean
      httpStatus?: number
      feishu?: unknown
      error?: string
    }
    const parsed = (await res.json()) as Wire
    if (parsed && typeof parsed === 'object') {
      if (parsed.ok === true) {
        return { ok: true, httpStatus: parsed.httpStatus ?? res.status, feishu: parsed.feishu }
      }
      return {
        ok: false,
        httpStatus: parsed.httpStatus ?? res.status,
        feishu: parsed.feishu,
        error: typeof parsed.error === 'string' ? parsed.error : '推送测试失败。',
      }
    }
    return { ok: false, httpStatus: res.status, error: '无法解析服务端响应。' }
  } catch (err) {
    return { ok: false, error: backendUnreachableMessage(path, err) }
  }
}

export async function postFeishuPushText(payload: {
  pushScope: PushApiScope
  webhookUrl: string
  signingSecret?: string
  text: string
}): Promise<FeishuPushTestOk | FeishuPushTestFail> {
  const path = '/api/feishu-webhook/push-text'
  try {
    const res = await backendFetchWithTimeout(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pushScope: payload.pushScope,
        webhookUrl: payload.webhookUrl.trim(),
        signingSecret: payload.signingSecret,
        text: payload.text,
      }),
    })
    type Wire = {
      ok?: boolean
      httpStatus?: number
      feishu?: unknown
      error?: string
    }
    const parsed = (await res.json()) as Wire
    if (parsed && typeof parsed === 'object') {
      if (parsed.ok === true) {
        return { ok: true, httpStatus: parsed.httpStatus ?? res.status, feishu: parsed.feishu }
      }
      return {
        ok: false,
        httpStatus: parsed.httpStatus ?? res.status,
        feishu: parsed.feishu,
        error: typeof parsed.error === 'string' ? parsed.error : '文案推送失败。',
      }
    }
    return { ok: false, httpStatus: res.status, error: '无法解析服务端响应。' }
  } catch (err) {
    return { ok: false, error: backendUnreachableMessage(path, err) }
  }
}

export async function postFeishuPushCard(payload: {
  pushScope: PushApiScope
  webhookUrl: string
  signingSecret?: string
  card: Record<string, unknown>
}): Promise<FeishuPushTestOk | FeishuPushTestFail> {
  const path = '/api/feishu-webhook/push-card'
  try {
    const res = await backendFetchWithTimeout(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pushScope: payload.pushScope,
        webhookUrl: payload.webhookUrl.trim(),
        signingSecret: payload.signingSecret,
        card: payload.card,
      }),
    })
    type Wire = { ok?: boolean; httpStatus?: number; feishu?: unknown; error?: string }
    const parsed = (await res.json()) as Wire
    if (parsed && typeof parsed === 'object') {
      if (parsed.ok === true) {
        return { ok: true, httpStatus: parsed.httpStatus ?? res.status, feishu: parsed.feishu }
      }
      return {
        ok: false,
        httpStatus: parsed.httpStatus ?? res.status,
        feishu: parsed.feishu,
        error: typeof parsed.error === 'string' ? parsed.error : '卡片推送失败。',
      }
    }
    return { ok: false, httpStatus: res.status, error: '无法解析服务端响应。' }
  } catch (err) {
    return { ok: false, error: backendUnreachableMessage(path, err) }
  }
}

export async function postFeishuPushRichMessage(payload: {
  pushScope: PushApiScope
  webhookUrl: string
  signingSecret?: string
  content: string
  images: string[]
  /** 勾选「@ 相关人员」时传该供应商花名册里选中的全部联系人 open_id */
  mentionOpenIds?: string[]
}): Promise<FeishuPushTestOk | FeishuPushTestFail> {
  const path = '/api/feishu-webhook/push-rich-message'
  try {
    const res = await backendFetchWithTimeout(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pushScope: payload.pushScope,
        webhookUrl: payload.webhookUrl.trim(),
        signingSecret: payload.signingSecret,
        content: payload.content,
        images: payload.images,
        mentionOpenIds: payload.mentionOpenIds,
      }),
    })
    type Wire = { ok?: boolean; httpStatus?: number; feishu?: unknown; error?: string; imageUploadedCount?: number }
    const parsed = (await res.json()) as Wire
    if (parsed && typeof parsed === 'object') {
      if (parsed.ok === true) {
        return { ok: true, httpStatus: parsed.httpStatus ?? res.status, feishu: parsed.feishu }
      }
      return {
        ok: false,
        httpStatus: parsed.httpStatus ?? res.status,
        feishu: parsed.feishu,
        error: typeof parsed.error === 'string' ? parsed.error : '富文本卡片推送失败。',
      }
    }
    return { ok: false, httpStatus: res.status, error: '无法解析服务端响应。' }
  } catch (err) {
    return { ok: false, error: backendUnreachableMessage(path, err) }
  }
}

export async function fetchDeliveryWeatherLarkMd(params: {
  lat: number
  lng: number
  label: string
}): Promise<{ ok: true; larkMd: string } | { ok: false; error: string }> {
  const qs = new URLSearchParams({
    lat: String(params.lat),
    lng: String(params.lng),
    label: params.label,
  })
  const path = `/api/feishu-webhook/delivery-weather?${qs.toString()}`
  try {
    const res = await backendFetch(path)
    const parsed = (await res.json()) as { ok?: boolean; data?: { larkMd?: string }; error?: string }
    if (parsed?.ok === true && typeof parsed.data?.larkMd === 'string') {
      return { ok: true, larkMd: parsed.data.larkMd }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '获取天气预报失败。' }
  } catch {
    return { ok: false, error: `无法访问后端 (${path})。` }
  }
}

export type FeishuBotChatOption = { chatId: string; name: string }

/** 列出自建应用机器人当前所在的群，供「选群」下拉填 chat_id（前提：群主/管理员已手动把机器人拉进群） */
export async function fetchFeishuAppBotChats(): Promise<
  { ok: true; chats: FeishuBotChatOption[] } | { ok: false; error: string }
> {
  const path = '/api/feishu-webhook/app-bot/chats'
  try {
    const res = await backendFetch(path)
    const parsed = (await res.json()) as { ok?: boolean; data?: FeishuBotChatOption[]; error?: string }
    if (parsed?.ok === true && Array.isArray(parsed.data)) {
      return { ok: true, chats: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '获取机器人所在群列表失败。' }
  } catch (err) {
    return { ok: false, error: backendUnreachableMessage(path, err) }
  }
}

/** 富文本 + 多图，走自建应用机器人（im/v1/messages）发送；仅当供应商配置了 chatId 时使用 */
export async function postFeishuPushRichMessageViaAppBot(payload: {
  pushScope: PushApiScope
  supplierConfigId?: string
  chatId: string
  pushLabel?: string
  content: string
  images: string[]
  mentionOpenIds?: string[]
}): Promise<FeishuPushTestOk | FeishuPushTestFail> {
  const path = '/api/feishu-webhook/push-rich-message-app'
  try {
    const res = await backendFetchWithTimeout(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pushScope: payload.pushScope,
        supplierConfigId: payload.supplierConfigId,
        chatId: payload.chatId.trim(),
        pushLabel: payload.pushLabel,
        content: payload.content,
        images: payload.images,
        mentionOpenIds: payload.mentionOpenIds,
      }),
    })
    type Wire = { ok?: boolean; httpStatus?: number; feishu?: unknown; error?: string; messageId?: string }
    const parsed = (await res.json()) as Wire
    if (parsed && typeof parsed === 'object') {
      if (parsed.ok === true) {
        return { ok: true, httpStatus: res.status, feishu: parsed }
      }
      return {
        ok: false,
        httpStatus: parsed.httpStatus ?? res.status,
        feishu: parsed.feishu,
        error: typeof parsed.error === 'string' ? parsed.error : '应用机器人富文本推送失败。',
      }
    }
    return { ok: false, httpStatus: res.status, error: '无法解析服务端响应。' }
  } catch (err) {
    return { ok: false, error: backendUnreachableMessage(path, err) }
  }
}

export type FeishuChatMemberOption = { userId: string; name: string }

/** 列出某个群的全量成员（含外部联系人），供「@ 外部联系人」下拉选择 */
export async function fetchFeishuChatMembers(
  chatId: string,
): Promise<{ ok: true; members: FeishuChatMemberOption[] } | { ok: false; error: string }> {
  const path = `/api/feishu-webhook/app-bot/chats/${encodeURIComponent(chatId)}/members`
  try {
    const res = await backendFetch(path)
    const parsed = (await res.json()) as { ok?: boolean; data?: FeishuChatMemberOption[]; error?: string }
    if (parsed?.ok === true && Array.isArray(parsed.data)) {
      return { ok: true, members: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '获取群成员列表失败。' }
  } catch (err) {
    return { ok: false, error: backendUnreachableMessage(path, err) }
  }
}

export type FeishuPushMessageRecord = {
  id: string
  supplierConfigId: string | null
  chatId: string
  messageId: string
  msgType: string
  pushLabel: string | null
  createdAt: string
}

/** 某供应商最近的应用机器人推送记录，供「查看已读」入口列表 */
export async function fetchFeishuPushMessages(
  supplierConfigId: string,
): Promise<{ ok: true; data: FeishuPushMessageRecord[] } | { ok: false; error: string }> {
  const path = `/api/feishu-webhook/push-messages?supplierConfigId=${encodeURIComponent(supplierConfigId)}`
  try {
    const res = await backendFetch(path)
    const parsed = (await res.json()) as { ok?: boolean; data?: FeishuPushMessageRecord[]; error?: string }
    if (parsed?.ok === true && Array.isArray(parsed.data)) {
      return { ok: true, data: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '获取推送记录失败。' }
  } catch (err) {
    return { ok: false, error: backendUnreachableMessage(path, err) }
  }
}

export type FeishuReadStatusUser = { userId: string; name: string; readAtMs?: number }
export type FeishuReadStatus = {
  messageId: string
  sentAt: string
  totalMembers: number
  readCount: number
  readUsers: FeishuReadStatusUser[]
  unreadUsers: FeishuReadStatusUser[]
}

/** 查询某条应用机器人消息的已读/未读名单（飞书仅允许查发送后 7 天内的消息） */
export async function fetchFeishuPushMessageReadStatus(
  pushMessageId: string,
): Promise<{ ok: true; data: FeishuReadStatus } | { ok: false; error: string }> {
  const path = `/api/feishu-webhook/push-messages/${encodeURIComponent(pushMessageId)}/read-status`
  try {
    const res = await backendFetch(path)
    const parsed = (await res.json()) as { ok?: boolean; data?: FeishuReadStatus; error?: string }
    if (parsed?.ok === true && parsed.data) {
      return { ok: true, data: parsed.data }
    }
    return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : '查询已读状态失败。' }
  } catch (err) {
    return { ok: false, error: backendUnreachableMessage(path, err) }
  }
}

export function summarizeFeishuTestFailure(result: FeishuPushTestFail): string {
  if (result.error && !result.feishu) return result.error
  const fb = result.feishu as Record<string, unknown> | null | undefined
  const msg = fb && typeof fb.msg === 'string' ? fb.msg : ''
  const code = fb && typeof fb.code !== 'undefined' ? String(fb.code) : ''
  const suffix = msg || code ? `飞书响应：${[code ? `code ${code}` : '', msg].filter(Boolean).join(' · ')}` : ''
  return [result.error ?? '推送测试失败。', suffix].filter(Boolean).join(' ')
}

export async function postFeishuPushImage(
  payload: FeishuPushImagePayload,
): Promise<FeishuPushImageOk | FeishuPushImageFail> {
  const path = '/api/feishu-webhook/push-image'
  try {
    const res = await backendFetchWithTimeout(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pushScope: payload.pushScope,
        webhookUrl: payload.webhookUrl.trim(),
        signingSecret: payload.signingSecret,
        imageBase64: payload.imageBase64,
        headlineText: typeof payload.headlineText === 'string' ? payload.headlineText : undefined,
        ...(payload.dataSnapshot && typeof payload.dataSnapshot === 'object'
          ? { dataSnapshot: payload.dataSnapshot }
          : {}),
      }),
    })
    type WireOk = {
      ok?: boolean
      httpStatus?: number
      feishu?: unknown
      imageUploaded?: boolean
      error?: string
      feishuUpload?: unknown
      aiAnalysisGenerated?: boolean
      aiAnalysisError?: string
    }
    const parsed = (await res.json()) as WireOk
    if (parsed && typeof parsed === 'object') {
      if (parsed.ok === true) {
        return {
          ok: true,
          httpStatus: parsed.httpStatus ?? res.status,
          feishu: parsed.feishu,
          imageUploaded: parsed.imageUploaded,
          aiAnalysisGenerated: parsed.aiAnalysisGenerated,
          aiAnalysisError: typeof parsed.aiAnalysisError === 'string' ? parsed.aiAnalysisError : undefined,
        }
      }
      return {
        ok: false,
        httpStatus: parsed.httpStatus ?? res.status,
        feishu: parsed.feishu,
        feishuUpload: parsed.feishuUpload,
        error: typeof parsed.error === 'string' ? parsed.error : '图片推送失败。',
      }
    }
    return { ok: false, httpStatus: res.status, error: '无法解析服务端响应。' }
  } catch (err) {
    return { ok: false, error: backendUnreachableMessage(path, err) }
  }
}

export function summarizeFeishuPushImageFailure(result: FeishuPushImageFail): string {
  if (result.feishuUpload && typeof result.feishuUpload === 'object') {
    const upl = result.feishuUpload as Record<string, unknown>
    const umsg = typeof upl.msg === 'string' ? upl.msg : ''
    const ucode = typeof upl.code !== 'undefined' ? String(upl.code) : ''
    if (umsg || ucode)
      return [result.error ?? '上传图片失败', `飞书上载：${[ucode ? `code ${ucode}` : '', umsg].filter(Boolean).join(' · ')}`].join(
        ' · ',
      )
  }
  if (result.error && !result.feishu) return result.error
  const fb = result.feishu as Record<string, unknown> | null | undefined
  const msg = fb && typeof fb.msg === 'string' ? fb.msg : ''
  const code = fb && typeof fb.code !== 'undefined' ? String(fb.code) : ''
  const suffix = msg || code ? `飞书 webhook：${[code ? `code ${code}` : '', msg].filter(Boolean).join(' · ')}` : ''
  return [result.error ?? '图片推送失败', suffix].filter(Boolean).join(' · ')
}
