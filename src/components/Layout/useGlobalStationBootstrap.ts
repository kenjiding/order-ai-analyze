import { useEffect, useRef } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { fetchStations } from '../../pages/VendorAnalysis/stationsApi'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'

export const GLOBAL_SELECTED_STATIONS_KEY = 'global_selected_stations_v1'

/** 模块级防重：独立页菜单卸载/重挂时不重复 hydrate */
let selectionHydrated = false

/**
 * 从 localStorage 回填已选责任站点，并按「国家选择器」拉取
 * `/lm/express/base/v1/search/auth/permission/station`（经后端代理）。
 * 国家一变立刻清空旧列表并重新请求。
 */
export function useGlobalStationBootstrap() {
  const { imileToken } = useAppSettings()
  const {
    selectedCountry,
    setSelectedStations,
    setStations,
    setStationsLoading,
  } = useGlobalFilterStore()
  const prevCountryRef = useRef<string | null>(null)

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
    if (!imileToken) return

    const countryChanged =
      prevCountryRef.current !== null && prevCountryRef.current !== selectedCountry
    prevCountryRef.current = selectedCountry

    // 国家切换：立刻清空旧站点列表与已选，避免短暂展示上一国家的数据
    if (countryChanged) {
      setStations([])
      setSelectedStations([])
      localStorage.removeItem(GLOBAL_SELECTED_STATIONS_KEY)
    }

    let cancelled = false
    setStationsLoading(true)
    void fetchStations(imileToken, selectedCountry).then((res) => {
      if (cancelled) return
      setStationsLoading(false)
      if (res.ok) setStations(res.data)
      else showToast(`站点加载失败: ${res.error}`, 'error')
    })

    return () => {
      cancelled = true
    }
  }, [
    imileToken,
    selectedCountry,
    setSelectedStations,
    setStations,
    setStationsLoading,
  ])
}
