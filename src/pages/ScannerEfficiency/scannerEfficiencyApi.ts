import { getApiBaseUrl } from '../../utils/apiBaseUrl'
import type { ImilePortalSettings } from '../../imile/imilePortalSettings'
import { toImilePortalOverrides } from '../../imile/imilePortalSettings'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const
const scannerEfficiencyApi = `${getApiBaseUrl()}/api/scanner-efficiency`

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const j = JSON.parse(text) as { error?: string }
    if (j.error) return j.error
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`
}

export type FetchInboundScansResult = {
  /** iMile resultObject.results 原始项，字段未裁剪 */
  records: unknown[]
  /** 分页完整 HTTP JSON 响应（单页为对象，多页为 { batch, responses }） */
  raw: unknown
  meta: {
    startDate: string
    endDate: string
    totalResult: number
    fetched: number
  }
}

export async function fetchInboundScans(payload: {
  imileToken: string
  startDate: string
  endDate: string
  imilePortal?: ImilePortalSettings
}): Promise<FetchInboundScansResult> {
  const res = await fetch(`${scannerEfficiencyApi}/inbound-scans`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'include',
    body: JSON.stringify({
      imileToken: payload.imileToken,
      startDate: payload.startDate,
      endDate: payload.endDate,
      imilePortal: payload.imilePortal ? toImilePortalOverrides(payload.imilePortal) : undefined,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as FetchInboundScansResult
}
