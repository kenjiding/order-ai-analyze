export type FineBiConnectionConfig = {
  label: string
  /** 浏览器抓取的 widget/data 完整 URL，含 reportId 与 link */
  widgetDataUrl: string
  authToken: string
  enabled: boolean
}

export const DEFAULT_FINEBI_BASE_URL = 'https://de-finebi.imile-inc.com/finebi01/decision'

/** 由第 2 组接口数据计算，无独立 widget/data URL */
export const FINEBI_METRIC_NOT_MET_24H_LABEL = '24小时签收未达标'

export const DEFAULT_FINEBI_CONNECTIONS: FineBiConnectionConfig[] = [
  {
    label: '11点前出仓率',
    widgetDataUrl: '',
    authToken: '',
    enabled: true,
  },
  {
    label: '24小时签派率',
    widgetDataUrl: '',
    authToken: '',
    enabled: true,
  },
]

const STORAGE_KEY_V2 = 'vendor-analysis-finebi-connections-v2'
const STORAGE_KEY_V1 = 'vendor-analysis-finebi-connections-v1'

type LegacyFineBiConnectionConfig = Partial<FineBiConnectionConfig> & {
  reportId?: string
  shareLink?: string
  baseUrl?: string
}

export function buildWidgetDataUrlFromParts(
  baseUrl: string,
  reportId: string,
  shareLink: string,
): string {
  const base = (baseUrl || DEFAULT_FINEBI_BASE_URL).replace(/\/$/, '')
  return `${base}/v5/design/report/share/widget/data?engineType=1&reportId=${encodeURIComponent(reportId)}&link=${encodeURIComponent(shareLink)}`
}

function normalizeConnection(
  item: LegacyFineBiConnectionConfig,
  defaultItem: FineBiConnectionConfig,
): FineBiConnectionConfig {
  const widgetDataUrl = item.widgetDataUrl?.trim()
    || (item.reportId?.trim() && item.shareLink?.trim()
      ? buildWidgetDataUrlFromParts(item.baseUrl ?? DEFAULT_FINEBI_BASE_URL, item.reportId, item.shareLink)
      : '')

  return {
    label: item.label?.trim() || defaultItem.label,
    widgetDataUrl,
    authToken: item.authToken?.trim() ?? '',
    enabled: item.enabled ?? defaultItem.enabled,
  }
}

function loadFromStorageKey(key: string): FineBiConnectionConfig[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LegacyFineBiConnectionConfig[]
    if (!Array.isArray(parsed) || parsed.length < 2) return null
    return parsed.slice(0, 2).map((item, i) => normalizeConnection(item, DEFAULT_FINEBI_CONNECTIONS[i]))
  } catch {
    return null
  }
}

export function loadFineBiConnections(): FineBiConnectionConfig[] {
  const v2 = loadFromStorageKey(STORAGE_KEY_V2)
  if (v2) return v2

  const v1 = loadFromStorageKey(STORAGE_KEY_V1)
  if (v1) {
    saveFineBiConnections(v1)
    return v1
  }

  return DEFAULT_FINEBI_CONNECTIONS.map((c) => ({ ...c }))
}

export function saveFineBiConnections(connections: FineBiConnectionConfig[]): void {
  localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(connections.slice(0, 2)))
}

export function parseFineBiWidgetDataUrl(raw: string): {
  reportId: string
  shareLink: string
  baseUrl: string
} | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const url = text.startsWith('http') ? new URL(text) : new URL(text, 'https://placeholder.local')
    const reportId = url.searchParams.get('reportId')?.trim() ?? ''
    const shareLink = url.searchParams.get('link')?.trim() ?? ''
    if (!reportId || !shareLink) return null
    let baseUrl = DEFAULT_FINEBI_BASE_URL
    if (text.startsWith('http')) {
      const path = url.pathname
      const idx = path.indexOf('/decision/')
      if (idx >= 0) {
        baseUrl = `${url.origin}${path.slice(0, idx + '/decision'.length)}`
      }
    }
    return { reportId, shareLink, baseUrl }
  } catch {
    return null
  }
}

export function isFineBiConnectionReady(config: FineBiConnectionConfig): boolean {
  return config.enabled && parseFineBiWidgetDataUrl(config.widgetDataUrl) != null
}

function pickActiveConnectionAt(
  connections: FineBiConnectionConfig[],
  index: number,
): FineBiConnectionConfig | null {
  const config = connections[index]
  if (!config || !isFineBiConnectionReady(config)) return null
  return config
}

export function pickActivePickupConnection(
  connections: FineBiConnectionConfig[],
): FineBiConnectionConfig | null {
  return pickActiveConnectionAt(connections, 0)
}

export function pickActive24hDispatchConnection(
  connections: FineBiConnectionConfig[],
): FineBiConnectionConfig | null {
  return pickActiveConnectionAt(connections, 1)
}

export function toFineBiConnectionInput(config: FineBiConnectionConfig): {
  reportId: string
  shareLink: string
  baseUrl?: string
  authToken?: string
  widgetDataUrl?: string
} {
  const parsed = parseFineBiWidgetDataUrl(config.widgetDataUrl)
  if (!parsed) {
    throw new Error('FineBI widget/data URL 无效，需包含 reportId 与 link 参数')
  }
  return {
    reportId: parsed.reportId,
    shareLink: parsed.shareLink,
    baseUrl: parsed.baseUrl || undefined,
    authToken: config.authToken.trim() || undefined,
    widgetDataUrl: config.widgetDataUrl.trim() || undefined,
  }
}
