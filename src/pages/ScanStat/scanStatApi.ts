import { backendFetch } from '../../api/httpClient'

export type ScanStatGroup = {
  kind: 'merchant' | 'unknown' | 'unmatched'
  clientCode: string
  clientName: string
  waybillNos: string[]
}

export type ScanStatLookupData = {
  total: number
  groups: ScanStatGroup[]
  recipientName?: string
}

export type ScanStatSendData = {
  total: number
  recipientName?: string
}

type Fail = { ok: false; error: string; unauthorized?: boolean }

async function postScanStat<T>(path: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | Fail> {
  try {
    const res = await backendFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 401) return { ok: false, error: '登录已过期，请重新登录', unauthorized: true }
    const parsed = (await res.json()) as { ok?: boolean; data?: T; error?: string }
    if (parsed.ok === true && parsed.data) return { ok: true, data: parsed.data }
    return { ok: false, error: typeof parsed.error === 'string' ? parsed.error : '请求失败' }
  } catch {
    return { ok: false, error: `无法访问后端 (${path})。请确认已运行 server 或检查 VITE_API_BASE。` }
  }
}

/** 查商家：查到的商家分组直接发给飞书接收人。 */
export function lookupScanStat(params: {
  stationName: string
  waybillNos: string[]
  openId: string
  recipientName: string
}) {
  return postScanStat<ScanStatLookupData>('/api/scan-stat/lookup', {
    stationName: params.stationName,
    waybillNos: params.waybillNos,
    openId: params.openId,
    recipientName: params.recipientName,
  })
}

/** 单纯把扫到的运单号发给飞书接收人，不查商家。 */
export function sendScanStatNos(params: {
  stationName: string
  waybillNos: string[]
  openId: string
  recipientName: string
}) {
  return postScanStat<ScanStatSendData>('/api/scan-stat/send-nos', {
    stationName: params.stationName,
    waybillNos: params.waybillNos,
    openId: params.openId,
    recipientName: params.recipientName,
  })
}
