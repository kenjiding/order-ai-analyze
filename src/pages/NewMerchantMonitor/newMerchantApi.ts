import { backendFetch } from '../../api/httpClient'
import type { ImilePortalSettings } from '../../imile/imilePortalSettings'
import { toImilePortalOverrides } from '../../imile/imilePortalSettings'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const j = JSON.parse(text) as { error?: string }
    if (j.error) return j.error
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`
}

export type FetchNewMerchantWaybillsResult = {
  records: unknown[]
  meta: {
    startTime: string
    endTime: string
    clientCodes: string[]
    fetched: number
    totalResult: number
  }
}

export async function fetchNewMerchantWaybills(payload: {
  imileToken: string
  clientCodes: string[]
  startDate: string
  endDate: string
  imilePortal?: ImilePortalSettings
}): Promise<FetchNewMerchantWaybillsResult> {
  const res = await backendFetch('/api/new-merchant/waybills', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      imileToken: payload.imileToken,
      clientCodes: payload.clientCodes,
      startDate: payload.startDate,
      endDate: payload.endDate,
      imilePortal: payload.imilePortal ? toImilePortalOverrides(payload.imilePortal) : undefined,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as FetchNewMerchantWaybillsResult
}
