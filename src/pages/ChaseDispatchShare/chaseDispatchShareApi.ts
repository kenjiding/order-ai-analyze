import { backendFetch } from '../../api/httpClient'
import type { DriverMapPointsResponse } from '../../components/DriverMap/driverMapTypes'

export type ChaseDispatchShareWaybill = {
  waybillNo: string
  routeCode: string
}

export type ChaseDispatchShareDriver = {
  driverName: string
  driverCode: string
  count: number
  waybills: ChaseDispatchShareWaybill[]
}

export type ChaseDispatchShareBucket = {
  bucket: string
  label: string
  count: number
  drivers: ChaseDispatchShareDriver[]
}

export type ChaseDispatchShareView = {
  vendorCode: string
  vendorName: string
  baseDate: string
  pushTime: string
  totalStagnant: number
  buckets: ChaseDispatchShareBucket[]
  createdAt: string
}

/** 无登录态；credentials 可不带，保持与门户其它公开接口一致 */
export async function fetchChaseDispatchShare(
  token: string,
): Promise<{ ok: true; data: ChaseDispatchShareView } | { ok: false; error: string }> {
  try {
    const path = `/api/chase-dispatch-portal/${encodeURIComponent(token)}`
    const res = await backendFetch(path, { headers: { Accept: 'application/json' } })
    const json = (await res.json()) as { ok?: boolean; data?: ChaseDispatchShareView; error?: string }
    if (json.ok === true && json.data) return { ok: true, data: json.data }
    return { ok: false, error: typeof json.error === 'string' ? json.error : 'not_found' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export type DispatchAlarmShareWaybill = {
  waybillNo: string
  routeCode: string
}

export type DispatchAlarmShareDriver = {
  courierCode: string
  courierName: string
  total: number
  met: number
  problemCount: number
  neverSignedWaybills: DispatchAlarmShareWaybill[]
  lateSignedWaybills: DispatchAlarmShareWaybill[]
  problemWaybills: DispatchAlarmShareWaybill[]
}

export type DispatchAlarmShareView = {
  vendorCode: string
  vendorName: string
  stationCode: string
  date: string
  pushTime: string
  total: number
  met: number
  problemCount: number
  alertThresholdPct: number
  drivers: DispatchAlarmShareDriver[]
  createdAt: string
}

/** 无登录态；与催派推送门户共用同一落地页组件，仅数据源不同 */
export async function fetchDispatchAlarmShare(
  token: string,
): Promise<{ ok: true; data: DispatchAlarmShareView } | { ok: false; error: string }> {
  try {
    const path = `/api/dispatch-alarm-portal/${encodeURIComponent(token)}`
    const res = await backendFetch(path, { headers: { Accept: 'application/json' } })
    const json = (await res.json()) as { ok?: boolean; data?: DispatchAlarmShareView; error?: string }
    if (json.ok === true && json.data) return { ok: true, data: json.data }
    return { ok: false, error: typeof json.error === 'string' ? json.error : 'not_found' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

/** 无登录态；站点/日期/供应商取自本次推送快照，供 PublicDriverMapSection 复用 */
export async function fetchDispatchAlarmDriverMap(
  token: string,
): Promise<{ ok: true; data: DriverMapPointsResponse | null } | { ok: false; error: string }> {
  try {
    const path = `/api/dispatch-alarm-portal/driver-map/${encodeURIComponent(token)}`
    const res = await backendFetch(path, { headers: { Accept: 'application/json' } })
    const json = (await res.json()) as { ok?: boolean; data?: DriverMapPointsResponse | null; error?: string }
    if (json.ok === true) return { ok: true, data: json.data ?? null }
    return { ok: false, error: typeof json.error === 'string' ? json.error : 'not_found' }
  } catch {
    return { ok: false, error: 'network' }
  }
}
