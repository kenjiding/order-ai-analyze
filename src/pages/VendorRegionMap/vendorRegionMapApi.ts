import { backendFetch } from '../../api/httpClient'
import type { VendorRegionMapResult, VendorVolumeTrendResult } from './vendorRegionMapTypes'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const json = JSON.parse(text) as { error?: string }
    if (json.error) return json.error
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`
}

export async function fetchVendorRegionMap(payload: {
  imileToken: string
  startDate: string
  endDate: string
}): Promise<VendorRegionMapResult> {
  const res = await backendFetch('/api/vendor-region-map/aggregate', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as VendorRegionMapResult
}

export async function fetchVendorVolumeTrend(payload: {
  imileToken: string
  startDate: string
  endDate: string
}): Promise<VendorVolumeTrendResult> {
  const res = await backendFetch('/api/vendor-region-map/trend', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as VendorVolumeTrendResult
}
