import { backendFetch } from '../../api/httpClient'
import type { FleetScanRow } from './fleetSupplierPushTypes'

export type FleetInboundScansResult = {
  rows: FleetScanRow[]
  droppedRows: number
  totalResult: number
  /** 部分站点查询失败时的明细；非空也可能同时带有其余站点成功的 rows */
  hubErrors: { hubCode: string; error: string }[]
}

/** 拉取「入站数据」（iMile 到件扫描 inbound/query）：按弹窗里多选的站点逐个查询并合并 */
export async function fetchFleetInboundScans(
  input: { startTime: string; endTime: string; hubCodes: string[] },
): Promise<{ ok: true; data: FleetInboundScansResult } | { ok: false; error: string }> {
  try {
    const res = await backendFetch('/api/fleet-supplier-push/inbound-scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const json = (await res.json()) as { ok?: boolean; data?: FleetInboundScansResult; error?: string }
    if (json.ok === true && json.data) return { ok: true, data: json.data }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '' }
  }
}
