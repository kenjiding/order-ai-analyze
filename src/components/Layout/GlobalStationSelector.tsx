import { Select } from 'antd'
import { MapPin } from 'lucide-react'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { GLOBAL_SELECTED_STATIONS_KEY } from './useGlobalStationBootstrap'

export function GlobalStationSelector() {
  const { selectedStations, stations, stationsLoading, setSelectedStations } = useGlobalFilterStore()

  const handleChange = (value: string | undefined) => {
    const next = value ? [value] : []
    setSelectedStations(next)
    if (next.length > 0) localStorage.setItem(GLOBAL_SELECTED_STATIONS_KEY, JSON.stringify(next))
    else localStorage.removeItem(GLOBAL_SELECTED_STATIONS_KEY)
  }

  return (
    <div className="flex items-center">
      <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <Select
        variant="borderless"
        value={selectedStations[0]}
        onChange={handleChange}
        options={stations.map((s) => ({ label: s.label, value: s.value }))}
        loading={stationsLoading}
        placeholder="责任站点"
        suffixIcon={null}
        popupMatchSelectWidth={false}
      />
    </div>
  )
}
