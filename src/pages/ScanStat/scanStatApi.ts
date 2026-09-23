import { backendFetch } from '../../api/httpClient'

export type ScanStatGroup = {
  kind: 'merchant' | 'unknown' | 'unmatched'
  clientCode: string
  clientName: string
  waybillNos: string[]
}

export type ScanStatData = {
  total: number
  groups: ScanStatGroup[]
  recipientName?: string
}

type Fail = { ok: false; error: string; unauthorized?: boolean }

async function postScanStat(
  path: string,
  imileToken: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: ScanStatData } | Fail> {
  try {
    const res = await backendFetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${imileToken}`,
      },
      body: JSON.stringify(body),
    })
    if (res.status === 401) return { ok: false, error: '登录已过期，请重新登录', unauthorized: true }
    const parsed = (await res.json()) as { ok?: boolean; data?: ScanStatData; error?: string }
    if (parsed.ok === true && parsed.data) return { ok: true, data: parsed.data }
    return { ok: false, error: typeof parsed.error === 'string' ? parsed.error : '请求失败' }
  } catch {
    return { ok: false, error: `无法访问后端 (${path})。请确认已运行 server 或检查 VITE_API_BASE。` }
  }
}

export function lookupScanStat(params: {
  imileToken: string
  stationCode: string
  waybillNos: string[]
}) {
  return postScanStat('/api/scan-stat/lookup', params.imileToken, {
    stationCode: params.stationCode,
    waybillNos: params.waybillNos,
  })
}

export function pushScanStat(params: {
  imileToken: string
  stationCode: string
  stationName: string
  waybillNos: string[]
  openId: string
  recipientName: string
}) {
  return postScanStat('/api/scan-stat/push', params.imileToken, {
    stationCode: params.stationCode,
    stationName: params.stationName,
    waybillNos: params.waybillNos,
    openId: params.openId,
    recipientName: params.recipientName,
  })
}
