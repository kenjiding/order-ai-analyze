import { backendFetch } from '../../api/httpClient'
import type {
  CancelScanRecheckMeta,
  DriverVendorEnrichMeta,
  OrderAnalyzeApiTiming,
  OrderAnalyzeInterceptLog,
  OrderAnalyzeResultItem,
  OrderAnalyzeTokenUsage,
  OrderQueryInfo,
  OrderTrackFacts,
} from '../OrderExceptionManagement/orderExceptionApi'
import type { TrackEvent } from '../OrderExceptionManagement/types'

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

export type InHubPackageLossWaybills = {
  waybillNos: string[]
  total: number
  byScanType: Record<string, number>
  exceptionClosedCount?: number
}

export async function postInHubPackageLossWaybills(payload: {
  imileToken: string
  stationCode: string
  start: string
  end: string
}): Promise<InHubPackageLossWaybills> {
  const res = await backendFetch('/api/package-loss-monitor/in-hub-waybills', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as InHubPackageLossWaybills
}

export type InHubPackageLossAnalyzeResponse = {
  results: OrderAnalyzeResultItem[]
  trackInfo: Record<string, TrackEvent[]>
  orderInfo: Record<string, OrderQueryInfo | null>
  interceptLogs: Record<string, OrderAnalyzeInterceptLog[]>
  tokenUsage: OrderAnalyzeTokenUsage
  timing?: OrderAnalyzeApiTiming
  trackFacts?: Record<string, OrderTrackFacts>
  cancelScanRecheck?: CancelScanRecheckMeta
  driverVendorEnrich?: DriverVendorEnrichMeta
}

export async function postInHubPackageLossAnalyze(payload: {
  imileToken: string
  orderNos: string[]
  scanStationCode?: string
  lossTimeoutDays?: number
}): Promise<InHubPackageLossAnalyzeResponse> {
  const res = await backendFetch('/api/package-loss-monitor/analyze', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as InHubPackageLossAnalyzeResponse
}
