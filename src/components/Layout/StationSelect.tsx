import { Select } from 'antd'
import { MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'

type Props = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function StationSelect({ value, onChange, disabled, placeholder, className = 'min-w-[200px]' }: Props) {
  const { t } = useTranslation('common')
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
        placeholder={placeholder ?? t('selectStation')}
        className={className}
        showSearch
        optionFilterProp="label"
      />
    </div>
  )
}
