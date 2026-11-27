import { backendFetch } from '../../api/httpClient'
import type { FleetScanRow } from './fleetSupplierPushTypes'

export type FleetPendingSplitBoxResult = {
  rows: FleetScanRow[]
  droppedRows: number
  totalResult: number
  /** 部分站点查询失败时的明细；非空也可能同时带有其余站点成功的 rows */
  hubErrors: { hubCode: string; error: string }[]
}

/**
 * 拉取「入站数据」（iMile pendingSplitBox）。
 * 传 hubCodes 时按多选站点逐个查询并合并；不传则沿用旧行为，跟随顶部站点选择器。
 */
export async function fetchFleetPendingSplitBox(
  input: { startTime: string; endTime: string; hubCodes?: string[] },
): Promise<{ ok: true; data: FleetPendingSplitBoxResult } | { ok: false; error: string }> {
  try {
    const res = await backendFetch('/api/fleet-supplier-push/pending-split-box', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const json = (await res.json()) as { ok?: boolean; data?: FleetPendingSplitBoxResult; error?: string }
    if (json.ok === true && json.data) return { ok: true, data: json.data }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '' }
  }
}
