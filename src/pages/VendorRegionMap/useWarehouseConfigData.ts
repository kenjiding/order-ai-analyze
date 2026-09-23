import { useEffect, useState } from 'react'
import { backendFetch } from '../../api/httpClient'

export type RegionWarehouseDto = { regionCode: string; name: string; address: string; lat: number; lng: number }
export type StationCoordinateDto = {
  stationCode: string
  stationName: string
  address: string
  lat: number
  lng: number
}

async function callApi<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(path, { headers: { 'Content-Type': 'application/json' } })
    const json = (await res.json()) as { ok?: boolean; data?: T; error?: string }
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '' }
  } catch {
    return { ok: false, error: '' }
  }
}

export type WarehouseConfigData = {
  regionWarehouse: RegionWarehouseDto | null
  stations: StationCoordinateDto[]
  loaded: boolean
}

/**
 * 大区主仓 + 站点坐标是静态参考数据，跟查询日期无关：进「区域地图」或「路由难度」Tab
 * 拉一次就够，两边共用同一份，不用各自重复请求。
 */
export function useWarehouseConfigData(): WarehouseConfigData {
  const [regionWarehouse, setRegionWarehouse] = useState<RegionWarehouseDto | null>(null)
  const [stations, setStations] = useState<StationCoordinateDto[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      callApi<RegionWarehouseDto | null>('/api/region-warehouses'),
      callApi<StationCoordinateDto[]>('/api/station-coordinates'),
    ]).then(([warehouseRes, stationsRes]) => {
      if (cancelled) return
      if (warehouseRes.ok) setRegionWarehouse(warehouseRes.data)
      if (stationsRes.ok) setStations(stationsRes.data)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { regionWarehouse, stations, loaded }
}
