import { backendFetch } from '../../api/httpClient'

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
}

export async function postInHubPackageLossWaybills(payload: {
  imileToken: string
  stationCode: string
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
