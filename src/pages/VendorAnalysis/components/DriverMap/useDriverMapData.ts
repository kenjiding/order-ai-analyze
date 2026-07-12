import { useCallback, useEffect, useRef, useState } from 'react'
import { getDriverMapPoints, triggerDriverMapRefresh } from './driverMapApi'
import type { DriverMapPointsResponse } from './driverMapTypes'

type DataState =
  | { status: 'loading' }
  | { status: 'ready'; data: DriverMapPointsResponse }
  | { status: 'error'; message: string }

export type DriverMapDataController = DataState & {
  refreshing: boolean
  refresh: () => Promise<boolean>
  reload: () => Promise<void>
}

export function useDriverMapData(params: {
  stationCode: string
  dataDate: string
  vendorCode?: string
}): DriverMapDataController {
  const [state, setState] = useState<DataState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const autoRefreshedKey = useRef<string>('')

  const reload = useCallback(async () => {
    if (!params.stationCode || !params.dataDate) return
    setState({ status: 'loading' })
    const res = await getDriverMapPoints(params)
    if (res.ok) setState({ status: 'ready', data: res.data })
    else setState({ status: 'error', message: res.error })
  }, [params.stationCode, params.dataDate, params.vendorCode])

  const refresh = useCallback(async () => {
    if (!params.stationCode || !params.dataDate) return false
    setRefreshing(true)
    try {
      const res = await triggerDriverMapRefresh(params)
      if (res.ok) {
        setState({ status: 'ready', data: res.data.points })
        return true
      }
      setState({ status: 'error', message: res.error })
      return false
    } finally {
      setRefreshing(false)
    }
  }, [params.stationCode, params.dataDate, params.vendorCode])

  useEffect(() => {
    void reload()
  }, [reload])

  // 缓存为空时自动增量刷新一次，避免「有签收率但地图空」却不知道要点刷新
  useEffect(() => {
    if (state.status !== 'ready') return
    if (state.data.totalCount > 0 || state.data.drivers.length > 0) return
    const key = `${params.stationCode}|${params.dataDate}|${params.vendorCode ?? ''}`
    if (autoRefreshedKey.current === key) return
    autoRefreshedKey.current = key
    void refresh()
  }, [state, params.stationCode, params.dataDate, params.vendorCode, refresh])

  return { ...state, refreshing, refresh, reload }
}
