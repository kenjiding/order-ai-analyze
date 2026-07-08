import { useEffect, useRef } from 'react'
import { Select } from 'antd'
import { MapPin } from 'lucide-react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { fetchStations } from '../../pages/VendorAnalysis/vendorAnalysisApi'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'

const STORAGE_KEY = 'global_selected_stations_v1'

export function GlobalStationSelector() {
  const { imileToken } = useAppSettings()
  const { selectedStations, stations, stationsLoading, setSelectedStations, setStations, setStationsLoading } =
    useGlobalFilterStore()
  const loadedRef = useRef(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed) && parsed.length > 0) setSelectedStations(parsed as string[])
      }
    } catch { /* ignore */ }
  }, [setSelectedStations])

  useEffect(() => {
    if (loadedRef.current || !imileToken) return
    loadedRef.current = true
    setStationsLoading(true)
    void fetchStations(imileToken).then((res) => {
      setStationsLoading(false)
      if (res.ok) setStations(res.data)
      else showToast(`站点加载失败: ${res.error}`, 'error')
    })
  }, [imileToken, setStations, setStationsLoading])

  const handleChange = (value: string | undefined) => {
    console.log('[GlobalStationSelector] 切换站点 stationCode =', value)
    const next = value ? [value] : []
    setSelectedStations(next)
    if (next.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <div className="flex items-center">
      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      <Select
        variant="borderless"
        value={selectedStations[0]}
        onChange={handleChange}
        options={stations.map((s) => ({ label: s.label, value: s.value }))}
        loading={stationsLoading}
        placeholder="责任站点"
        className="w-30"
      />
    </div>
  )
}
