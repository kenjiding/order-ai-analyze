import os from 'os'

/** 本机局域网 IPv4（跳过 127.0.0.1 等内部地址）；取不到则 null */
function detectLanIp(): string | null {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

/** 前端 vite 开发端口：取 CORS_ORIGIN 配的端口（本地默认 5173）；注意不能用 process.env.PORT——那是后端 API 端口 */
function resolveDevFrontendPort(): number {
  const corsRaw = String(process.env.CORS_ORIGIN ?? '').trim()
  const first = corsRaw.split(',').map((s) => s.trim()).find(Boolean)
  if (first) {
    try {
      const port = new URL(first).port
      if (port) return parseInt(port, 10)
    } catch {
      // CORS_ORIGIN 配置格式有问题，走默认端口
    }
  }
  return 5173
}

/**
 * 24H 派签告警分享链接专用 origin：本地开发环境下 PUBLIC_WEB_ORIGIN 在 .env 里硬编码成了生产IP，
 * 用它测试手机扫飞书卡片按钮会跳到线上而不是本机；改用本机局域网 IP，手机和开发机同一 WiFi 下才能连到。
 * 生产环境或探测不到局域网 IP 时原样回退 resolvePublicWebOrigin()。
 */
export function resolveDispatchAlarmShareOrigin(): string {
  if (process.env.NODE_ENV !== 'production') {
    const lanIp = detectLanIp()
    if (lanIp) return `http://${lanIp}:${resolveDevFrontendPort()}`
  }
  return resolvePublicWebOrigin()
}

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
  const origin = resolveDispatchAlarmShareOrigin()
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
