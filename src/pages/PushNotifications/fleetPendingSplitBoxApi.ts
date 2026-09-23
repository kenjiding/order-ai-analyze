import { backendFetch } from '../../api/httpClient'
import type { FleetScanRow } from './fleetSupplierPushTypes'

export type FleetPendingSplitBoxResult = {
  rows: FleetScanRow[]
  droppedRows: number
  totalResult: number
}

/** 拉取「入站数据」（iMile pendingSplitBox），跟随顶部国家/站点选择器，无需手传 country/hubcode */
export async function fetchFleetPendingSplitBox(
  input: { startTime: string; endTime: string },
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
