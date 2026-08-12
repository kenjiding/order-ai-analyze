import { fetchFeishuJson } from './feishuHttpClient'

const FEISHU_CHATS_URL = 'https://open.feishu.cn/open-apis/im/v1/chats'
const FEISHU_MESSAGES_URL = 'https://open.feishu.cn/open-apis/im/v1/messages'

const MAX_PAGES = 20

/**
 * 批量场景下调用方需要收紧单次调用的时间预算（默认 15s×3 次重试对批量接口太慢），透传给 fetchFeishuJson。
 * deadlineAt 额外约束分页循环：MAX_PAGES 是串行翻页，只靠单页超时兜不住总耗时。
 */
export type FeishuCallOptions = { timeoutMs?: number; maxRetries?: number; deadlineAt?: number }

/** 翻页前检查总预算，超了就整条按失败返回——返回半截名单会让未读人数算错，比报错更糟 */
function deadlineExceeded(options: FeishuCallOptions | undefined, page: number): boolean {
  return page > 0 && typeof options?.deadlineAt === 'number' && Date.now() >= options.deadlineAt
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
}

function feishuErrorMessage(json: unknown, httpStatus: number, fallback: string): string {
  const obj = asRecord(json)
  const msg = obj && typeof obj.msg === 'string' ? obj.msg : ''
  const code = obj && typeof obj.code !== 'undefined' ? String(obj.code) : ''
  if (msg || code) {
    return `${fallback}（飞书响应：${[code ? `code ${code}` : '', msg].filter(Boolean).join(' · ')}）`
  }
  return httpStatus && httpStatus !== 200 ? `${fallback}（HTTP ${httpStatus}）` : fallback
}

export type FeishuBotChat = { chatId: string; name: string }

/**
 * 列出自建应用机器人当前所在的群（用于「选群」填 chat_id）。
 * @see https://open.feishu.cn/document/server-docs/group/chat/list
 */
export async function listFeishuBotChats(
  tenantToken: string,
): Promise<{ ok: true; chats: FeishuBotChat[] } | { ok: false; error: string }> {
  const chats: FeishuBotChat[] = []
  let pageToken = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ page_size: '100' })
    if (pageToken) qs.set('page_token', pageToken)
    const result = await fetchFeishuJson(`${FEISHU_CHATS_URL}?${qs.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tenantToken}` },
    })
    if (!result.ok) return { ok: false, error: result.error }
    const obj = asRecord(result.json)
    const code = obj && typeof obj.code === 'number' ? obj.code : NaN
    if (code !== 0) {
      return { ok: false, error: feishuErrorMessage(result.json, result.httpStatus, '获取机器人所在群列表失败') }
    }
    const data = asRecord(obj?.data)
    const items = Array.isArray(data?.items) ? data.items : []
    for (const item of items) {
      const it = asRecord(item)
      const chatId = it && typeof it.chat_id === 'string' ? it.chat_id : ''
      if (!chatId) continue
      const name = it && typeof it.name === 'string' ? it.name : ''
      chats.push({ chatId, name })
    }
    const hasMore = data && typeof data.has_more === 'boolean' ? data.has_more : false
    pageToken = data && typeof data.page_token === 'string' ? data.page_token : ''
    if (!hasMore || !pageToken) break
  }
  return { ok: true, chats }
}

/**
 * 通过自建应用机器人发消息（服务端 API，非 webhook），返回 message_id 供后续查已读。
 * @see https://open.feishu.cn/document/server-docs/im-v1/message/create
 */
export async function sendFeishuAppMessage(
  tenantToken: string,
  chatId: string,
  msgType: 'text' | 'interactive' | 'image',
  content: Record<string, unknown>,
): Promise<{ ok: true; messageId: string; feishu: unknown } | { ok: false; error: string; feishu?: unknown }> {
  const qs = new URLSearchParams({ receive_id_type: 'chat_id' })
  const result = await fetchFeishuJson(`${FEISHU_MESSAGES_URL}?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantToken}` },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: msgType,
      content: JSON.stringify(content),
    }),
  })
  if (!result.ok) return { ok: false, error: result.error }
  const obj = asRecord(result.json)
  const code = obj && typeof obj.code === 'number' ? obj.code : NaN
  const data = asRecord(obj?.data)
  const messageId = data && typeof data.message_id === 'string' ? data.message_id : ''
  if (code !== 0 || !messageId) {
    return {
      ok: false,
      error: feishuErrorMessage(result.json, result.httpStatus, '应用机器人发送消息失败'),
      feishu: result.json,
    }
  }
  return { ok: true, messageId, feishu: result.json }
}

export type FeishuReadUser = { userId: string; readAtMs: number }

/**
 * 查询消息已读用户名单（仅限本机器人自己发出、7 天内的消息）。
 * @see https://open.feishu.cn/document/server-docs/im-v1/message/read_users
 */
export async function getFeishuMessageReadUsers(
  tenantToken: string,
  messageId: string,
  options?: FeishuCallOptions,
): Promise<{ ok: true; readUsers: FeishuReadUser[] } | { ok: false; error: string }> {
  const readUsers: FeishuReadUser[] = []
  let pageToken = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    if (deadlineExceeded(options, page)) return { ok: false, error: '查询已读用户超时（分页未取完）' }
    const qs = new URLSearchParams({ user_id_type: 'open_id', page_size: '100' })
    if (pageToken) qs.set('page_token', pageToken)
    const url = `${FEISHU_MESSAGES_URL}/${encodeURIComponent(messageId)}/read_users?${qs.toString()}`
    const result = await fetchFeishuJson(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tenantToken}` },
    }, options)
    if (!result.ok) return { ok: false, error: result.error }
    const obj = asRecord(result.json)
    const code = obj && typeof obj.code === 'number' ? obj.code : NaN
    if (code !== 0) {
      return { ok: false, error: feishuErrorMessage(result.json, result.httpStatus, '查询已读用户失败') }
    }
    const data = asRecord(obj?.data)
    const items = Array.isArray(data?.items) ? data.items : []
    for (const item of items) {
      const it = asRecord(item)
      const userId = it && typeof it.user_id === 'string' ? it.user_id : ''
      if (!userId) continue
      const timestampRaw = it && typeof it.timestamp === 'string' ? Number(it.timestamp) : NaN
      readUsers.push({ userId, readAtMs: Number.isFinite(timestampRaw) ? timestampRaw : 0 })
    }
    const hasMore = data && typeof data.has_more === 'boolean' ? data.has_more : false
    pageToken = data && typeof data.page_token === 'string' ? data.page_token : ''
    if (!hasMore || !pageToken) break
  }
  return { ok: true, readUsers }
}

export type FeishuChatMember = { userId: string; name: string }

/**
 * 列出群全量成员（不含机器人），用于跟已读名单做差集算出未读。
 * @see https://open.feishu.cn/document/server-docs/group/chat-member/get
 */
export async function listFeishuChatMembers(
  tenantToken: string,
  chatId: string,
  options?: FeishuCallOptions,
): Promise<{ ok: true; members: FeishuChatMember[] } | { ok: false; error: string }> {
  const members: FeishuChatMember[] = []
  let pageToken = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    if (deadlineExceeded(options, page)) return { ok: false, error: '获取群成员列表超时（分页未取完）' }
    const qs = new URLSearchParams({ member_id_type: 'open_id', page_size: '100' })
    if (pageToken) qs.set('page_token', pageToken)
    const url = `${FEISHU_CHATS_URL}/${encodeURIComponent(chatId)}/members?${qs.toString()}`
    const result = await fetchFeishuJson(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tenantToken}` },
    }, options)
    if (!result.ok) return { ok: false, error: result.error }
    const obj = asRecord(result.json)
    const code = obj && typeof obj.code === 'number' ? obj.code : NaN
    if (code !== 0) {
      return { ok: false, error: feishuErrorMessage(result.json, result.httpStatus, '获取群成员列表失败') }
    }
    const data = asRecord(obj?.data)
    const items = Array.isArray(data?.items) ? data.items : []
    for (const item of items) {
      const it = asRecord(item)
      const userId = it && typeof it.member_id === 'string' ? it.member_id : ''
      if (!userId) continue
      const name = it && typeof it.name === 'string' ? it.name : ''
      members.push({ userId, name })
    }
    const hasMore = data && typeof data.has_more === 'boolean' ? data.has_more : false
    pageToken = data && typeof data.page_token === 'string' ? data.page_token : ''
    if (!hasMore || !pageToken) break
  }
  return { ok: true, members }
}
