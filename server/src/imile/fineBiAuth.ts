import type { FineBiConnectionInput } from './fineBiTypes'

export type { FineBiConnectionInput } from './fineBiTypes'

const DEFAULT_FINEBI_BASE = 'https://de-finebi.imile-inc.com/finebi01/decision'

/** 历史公共链接 JWT 中的 userId，用于 create 接口（需有公共链接权限） */
const DEFAULT_PUBLIC_LINK_USER_ID = '9a8b0b1a-cc8f-44cf-8e4b-75e1b79d60e9'

const SHARE_LINK_CACHE_TTL_MS = 30 * 60 * 1000

let cachedShareLink: { value: string; cachedAt: number } | null = null

export type FineBiAuthConfig = {
  baseUrl: string
  /** FineBI Bearer；可选。无 token 时仅靠公共链接 link 调 share/widget/data（实测可行） */
  authToken: string | null
  reportId: string
  shareLink: string | null
  publicLinkUserId: string
  /** 浏览器抓取的原始 widget/data URL（含 templateId 等额外参数） */
  widgetDataUrl?: string
}

export function buildFineBiAuthConfig(
  input: FineBiConnectionInput,
): FineBiAuthConfig | { error: string } {
  const reportId = input.reportId?.trim() ?? ''
  const shareLink = input.shareLink?.trim() ?? ''
  if (!reportId) return { error: '缺少 FineBI reportId' }
  if (!shareLink) return { error: '缺少 FineBI shareLink（widget/data 的 link 参数）' }

  const rawToken = input.authToken?.trim() ?? ''
  const authToken = rawToken ? rawToken.replace(/^Bearer\s+/i, '').trim() : null

  const baseUrl = (input.baseUrl?.trim() || DEFAULT_FINEBI_BASE).replace(/\/$/, '')

  return {
    baseUrl,
    authToken,
    reportId,
    shareLink,
    publicLinkUserId: DEFAULT_PUBLIC_LINK_USER_ID,
    widgetDataUrl: input.widgetDataUrl?.trim() || undefined,
  }
}

/** FineBI 部分接口返回 JSONP：callback({...}) */
export function parseFineBiJson(text: string): unknown {
  const trimmed = text.trim()
  const jsonpMatch = /^callback\(([\s\S]*)\)\s*;?\s*$/.exec(trimmed)
  const jsonText = jsonpMatch ? jsonpMatch[1] : trimmed
  return JSON.parse(jsonText)
}

function buildRequestHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function readShareUriFromPublicLink(publicLink: unknown): string | null {
  if (!publicLink || typeof publicLink !== 'object') return null
  const link = publicLink as Record<string, unknown>
  for (const key of ['uri', 'link', 'token'] as const) {
    const value = link[key]
    if (typeof value === 'string' && value.startsWith('eyJ')) return value
  }
  return null
}

async function readFineBiApiJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, { headers: buildRequestHeaders(token) })
  const text = await res.text()
  try {
    return parseFineBiJson(text)
  } catch {
    throw new Error(`FineBI 返回非 JSON（HTTP ${res.status}）: ${text.slice(0, 200)}`)
  }
}

/**
 * 通过平台 API 读取/创建公共链接 JWT（即 widget/data 的 link 参数）。
 * 需要 token 对目标 reportId 具备公共链接相关权限；无权限时返回 null。
 */
export async function resolveFineBiShareLink(config: FineBiAuthConfig): Promise<string | null> {
  if (!config.authToken) return null

  if (cachedShareLink && Date.now() - cachedShareLink.cachedAt < SHARE_LINK_CACHE_TTL_MS) {
    return cachedShareLink.value
  }

  const infoParam = encodeURIComponent(JSON.stringify({ index: [{ id: config.reportId }] }))
  const infoUrl = `${config.baseUrl}/v5/api/platform/dashboard/reports/info?info=${infoParam}`

  try {
    const infoJson = await readFineBiApiJson(infoUrl, config.authToken)
    if (infoJson && typeof infoJson === 'object') {
      const root = infoJson as Record<string, unknown>
      const data = root.data
      if (data && typeof data === 'object') {
        const index = (data as Record<string, unknown>).index
        if (Array.isArray(index) && index[0] && typeof index[0] === 'object') {
          const uri = readShareUriFromPublicLink((index[0] as Record<string, unknown>).publicLink)
          if (uri) {
            cachedShareLink = { value: uri, cachedAt: Date.now() }
            return uri
          }
        }
      }
    }
  } catch (err) {
    console.warn('[FineBI] reports/info 读取公共链接失败:', err instanceof Error ? err.message : err)
  }

  const createUrl =
    `${config.baseUrl}/v5/api/platform/dashboard/${encodeURIComponent(config.reportId)}/create` +
    `?userId=${encodeURIComponent(config.publicLinkUserId)}`

  try {
    const createJson = await readFineBiApiJson(createUrl, config.authToken)
    if (createJson && typeof createJson === 'object') {
      const data = (createJson as Record<string, unknown>).data
      if (data && typeof data === 'object') {
        const uri = (data as Record<string, unknown>).uri
        if (typeof uri === 'string' && uri.startsWith('eyJ')) {
          cachedShareLink = { value: uri, cachedAt: Date.now() }
          return uri
        }
      }
    }
  } catch (err) {
    console.warn('[FineBI] create 公共链接失败:', err instanceof Error ? err.message : err)
  }

  return null
}

export function buildShareWidgetDataUrl(config: FineBiAuthConfig, shareLink: string): string {
  if (config.widgetDataUrl) {
    try {
      const url = new URL(config.widgetDataUrl)
      url.searchParams.set('link', shareLink)
      return url.toString()
    } catch {
      // fall through to default construction
    }
  }
  const qs = new URLSearchParams({
    engineType: '1',
    reportId: config.reportId,
    link: shareLink,
  })
  return `${config.baseUrl}/v5/design/report/share/widget/data?${qs.toString()}`
}

export type FineBiWidgetDataResult =
  | { ok: true; json: unknown }
  | { ok: false; status: number; message: string; rawText?: string }

/**
 * 拉取 FVS 内嵌汇总表数据（view 30000）。
 * 该接口在实测中仍需公共链接 link；Bearer 可选，不能单独替代 link。
 */
export async function postFineBiShareWidgetData(
  config: FineBiAuthConfig,
  body: Record<string, unknown>,
  shareLink: string,
): Promise<FineBiWidgetDataResult> {
  const url = buildShareWidgetDataUrl(config, shareLink)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildRequestHeaders(config.authToken),
      body: JSON.stringify(body),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 502, message: `FineBI 请求失败：${message}` }
  }

  const text = await res.text()

  if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
    return {
      ok: false,
      status: res.status || 502,
      message: 'FineBI 返回 HTML（公共链接无效或未开启）',
      rawText: text.slice(0, 300),
    }
  }

  let json: unknown
  try {
    json = parseFineBiJson(text)
  } catch {
    return {
      ok: false,
      status: res.status || 502,
      message: 'FineBI 返回非 JSON',
      rawText: text.slice(0, 500),
    }
  }

  if (json && typeof json === 'object' && (json as Record<string, unknown>).success === true) {
    return { ok: true, json }
  }

  const root = json as Record<string, unknown>
  const msg = root.errorMsg ?? root.message
  return {
    ok: false,
    status: res.status || 502,
    message: typeof msg === 'string' && msg.trim() ? msg : 'FineBI 查询失败',
    rawText: text.slice(0, 500),
  }
}

export function invalidateFineBiShareLinkCache(): void {
  cachedShareLink = null
}
