import { Select } from 'antd'
import { MapPin } from 'lucide-react'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'

type Props = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

/**
 * 独立的站点选择器：复用 Header「责任站点」选择器同一份站点列表数据源
 * （由 useGlobalStationBootstrap 在 Header 挂载时加载），但 value/onChange 走调用方
 * 自己的状态，不读写全局的 selectedStations —— 供表单内需要"选自己的站点"的场景使用。
 */
export function StationSelect({ value, onChange, disabled, placeholder = '选择站点' }: Props) {
  const { stations, stationsLoading } = useGlobalFilterStore()

  return (
    <div className="flex items-center gap-1.5">
      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      <Select
        value={value || undefined}
        onChange={(v) => onChange(v ?? '')}
        options={stations.map((s) => ({ label: s.label, value: s.value }))}
        loading={stationsLoading}
        disabled={disabled}
        placeholder={placeholder}
        className="min-w-[200px]"
        showSearch
        optionFilterProp="label"
      />
    </div>
  )
}
