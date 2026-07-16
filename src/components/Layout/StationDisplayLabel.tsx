import { useGlobalFilterStore } from '../../stores/globalFilterStore'

type Props = {
  stationCode: string
  className?: string
  emptyText?: string
}

/** 站点名 + 编码（如 S210791801），名称来自全局站点列表，缺失时仅展示编码 */
export function StationDisplayLabel({ stationCode, className, emptyText = '未选择站点' }: Props) {
  const stations = useGlobalFilterStore((s) => s.stations)
  const code = stationCode.trim()

  if (!code) {
    return <span className={`text-base font-semibold text-slate-800 ${className ?? ''}`.trim()}>{emptyText}</span>
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
