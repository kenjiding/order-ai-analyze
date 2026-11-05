import { Select } from 'antd'
import { MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'

type Props = {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}

/** 同 StationSelect 数据源（责任站点列表），差异只是多选 */
export function StationMultiSelect({ value, onChange, disabled, placeholder, className = 'min-w-[260px]' }: Props) {
  const { t } = useTranslation('common')
  const { stations, stationsLoading } = useGlobalFilterStore()

  return (
    <div className="flex items-center gap-1.5">
      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      <Select
        mode="multiple"
        value={value}
        onChange={(v) => onChange(v ?? [])}
        options={stations.map((s) => ({ label: s.label, value: s.value }))}
        loading={stationsLoading}
        disabled={disabled}
        placeholder={placeholder ?? t('selectStation')}
        className={className}
        showSearch
        optionFilterProp="label"
      />
    </div>
  )
}
