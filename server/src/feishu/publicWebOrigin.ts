/**
 * 前端公开页 origin（无末尾斜杠），用于服务端拼飞书卡片里的落地页链接。
 * 优先 PUBLIC_WEB_ORIGIN；否则取 CORS_ORIGIN 第一个；开发兜底 localhost:5173。
 */
export function resolvePublicWebOrigin(): string {
  const fromPublic = String(process.env.PUBLIC_WEB_ORIGIN ?? '').trim().replace(/\/$/, '')
  if (fromPublic) return fromPublic

  const corsRaw = String(process.env.CORS_ORIGIN ?? '').trim()
  if (corsRaw) {
    const first = corsRaw.split(',').map((s) => s.trim()).find(Boolean)
    if (first) return first.replace(/\/$/, '')
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'http://127.0.0.1:5173'
  }
  return ''
}

/** 催派分享落地页完整 URL；origin 未配置时返回 null（卡片不带按钮） */
export function buildChaseDispatchShareUrl(token: string): string | null {
  const origin = resolvePublicWebOrigin()
  if (!origin) return null
  return `${origin}/chase-dispatch-share/${encodeURIComponent(token)}`
}
