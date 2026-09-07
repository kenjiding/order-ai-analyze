import { useTranslation } from 'react-i18next'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'

type Props = {
  stationCode: string
  className?: string
  emptyText?: string
}

export function StationDisplayLabel({ stationCode, className, emptyText }: Props) {
  const { t } = useTranslation('common')
  const stations = useGlobalFilterStore((s) => s.stations)
  const code = stationCode.trim()
  const empty = emptyText ?? t('stationNotSelected')

  if (!code) {
    return <span className={`text-base font-semibold text-slate-800 ${className ?? ''}`.trim()}>{empty}</span>
  }

  const name = stations.find((s) => s.value === code)?.label?.trim()
  if (!name || name === code) {
    return (
      <span className={`font-mono text-base font-semibold text-slate-800 ${className ?? ''}`.trim()}>{code}</span>
    )
  }

  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className ?? ''}`.trim()}>
      <span className="text-base font-semibold text-slate-800">{name}</span>
      <span className="font-mono text-xs font-normal text-slate-400">{code}</span>
    </span>
  )
}
