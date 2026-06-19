import { getApiBaseUrl } from '../../../utils/apiBaseUrl'
import type { WarehouseConfigDto } from './types'

const warehouseConfigApi = `${getApiBaseUrl()}/api/order-exception/warehouse-config`

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const j = JSON.parse(text) as { error?: string }
    if (j.error) return j.error
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`
}

export async function fetchWarehouseConfig(): Promise<WarehouseConfigDto | null> {
  const res = await fetch(warehouseConfigApi)
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  const json = JSON.parse(text) as { config: WarehouseConfigDto | null }
  return json.config
}

export async function saveWarehouseConfigApi(config: WarehouseConfigDto): Promise<void> {
  const res = await fetch(warehouseConfigApi, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: config }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
}
