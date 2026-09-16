import { backendFetch } from '../../api/httpClient'

export type BagInfoRow = {
  bagNumber: string
  createDate: string
  targetCode: string
  waybillTotalCount: number
  type: string
}

export type BagFinishResult = {
  /** 集包号 */
  scanNumber: string
  clientCode: string
  ok: boolean
  blockCode?: number | null
  blockInfo?: string
  operateTypeDesc?: string
  error?: string
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

async function postJson<T>(path: string, imileToken: string, body: unknown): Promise<T> {
  const res = await backendFetch(path, {
    method: 'POST',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${imileToken}` },
    body: JSON.stringify(body),
  })
  const parsed = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null
  if (!res.ok || parsed?.ok !== true || !parsed.data) {
    throw new Error(parsed?.error || `请求失败 (HTTP ${res.status})`)
  }
  return parsed.data
}

export function fetchBagInfoRows(params: {
  imileToken: string
  stationCode: string
  startDate: string
  endDate: string
}): Promise<{ rows: BagInfoRow[]; total: number }> {
  return postJson('/api/return-to-merchant/bags', params.imileToken, {
    stationCode: params.stationCode,
    startDate: params.startDate,
    endDate: params.endDate,
  })
}

export function submitBagFinish(params: {
  imileToken: string
  stationCode: string
  bags: { bagNumber: string; targetCode: string }[]
}): Promise<{ total: number; successCount: number; results: BagFinishResult[] }> {
  return postJson('/api/return-to-merchant/submit', params.imileToken, {
    stationCode: params.stationCode,
    items: params.bags.map((bag) => ({
      id: bag.bagNumber,
      scanNumber: bag.bagNumber,
      clientCode: bag.targetCode,
    })),
  })
}
