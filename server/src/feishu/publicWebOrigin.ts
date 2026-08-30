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

/** 24小时派签告警分享落地页完整 URL；origin 未配置时返回 null（卡片不带按钮） */
export function buildDispatchAlarmShareUrl(token: string): string | null {
  const origin = resolvePublicWebOrigin()
  if (!origin) return null
  return `${origin}/dispatch-alarm-share/${encodeURIComponent(token)}`
}

/**
 * 容器流转记录的深链：带 transferId 定位到这一笔，action 决定进页面后自动打开哪个弹窗。
 * origin 未配置时返回 null（卡片退化为纯展示，不带按钮）。
 */
export function buildContainerTransferUrl(
  transferId: number,
  action?: 'confirm' | 'negotiate' | 'timeline',
): string | null {
  const origin = resolvePublicWebOrigin()
  if (!origin) return null
  const query = new URLSearchParams({ transferId: String(transferId) })
  if (action) query.set('action', action)
  return `${origin}/container/transfers?${query.toString()}`
}

/**
 * 容器流转列表页深链：批量汇总卡片用，只预置筛选、不定位到具体某一笔。
 * origin 未配置时返回 null（卡片退化为纯展示，不带按钮）。
 */
export function buildContainerTransferListUrl(params: {
  toAccountId?: string
  status?: string
}): string | null {
  const origin = resolvePublicWebOrigin()
  if (!origin) return null
  const query = new URLSearchParams()
  if (params.toAccountId) query.set('toAccountId', params.toAccountId)
  if (params.status) query.set('status', params.status)
  const suffix = query.toString()
  return suffix ? `${origin}/container/transfers?${suffix}` : `${origin}/container/transfers`
}
