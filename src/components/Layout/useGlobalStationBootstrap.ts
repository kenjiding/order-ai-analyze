import { useEffect } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { fetchStations } from '../../pages/VendorAnalysis/stationsApi'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'

export const GLOBAL_SELECTED_STATIONS_KEY = 'global_selected_stations_v1'

/** 模块级防重：独立页菜单卸载/重挂时不重复 hydrate / 拉站点 */
let selectionHydrated = false
let stationsFetchStarted = false

/**
 * 从 localStorage 回填已选责任站点，并在有 iMile Token 时拉取站点列表。
 * 须在页面打开时调用（不能只挂在折叠菜单内的选择器上）。
 */
export function useGlobalStationBootstrap() {
  const { imileToken } = useAppSettings()
  const { setSelectedStations, setStations, setStationsLoading } = useGlobalFilterStore()

  useEffect(() => {
    if (selectionHydrated) return
    selectionHydrated = true
    try {
      const raw = localStorage.getItem(GLOBAL_SELECTED_STATIONS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.length > 0) {
        setSelectedStations(parsed as string[])
      }
    } catch {
      /* ignore */
    }
  }, [setSelectedStations])

  useEffect(() => {
    if (stationsFetchStarted || !imileToken) return
    stationsFetchStarted = true
    setStationsLoading(true)
    void fetchStations(imileToken).then((res) => {
      setStationsLoading(false)
      if (res.ok) setStations(res.data)
      else showToast(`站点加载失败: ${res.error}`, 'error')
    })
  }, [imileToken, setStations, setStationsLoading])
}
