import { Tooltip } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { DispatchQuadrant } from '../dispatchPerformanceTypes'

type Props = {
  quadrant: DispatchQuadrant
  total: number
}

const SEGMENT_KEYS = [
  'exitMetSignMet',
  'exitMetSignUnmet',
  'exitUnmetSignMet',
  'exitUnmetSignUnmet',
] as const

const SEGMENT_COLORS = {
  exitMetSignMet: 'var(--admin-success, #16a34a)',
  exitMetSignUnmet: '#f59e0b',
  exitUnmetSignMet: '#3b82f6',
  exitUnmetSignUnmet: '#dc2626',
} as const

export function QuadrantBar({ quadrant, total }: Props) {
  const { t } = useTranslation('dispatchPerformance')

  const segments = useMemo(
    () =>
      SEGMENT_KEYS.map((key) => ({
        key,
        label: t(`quadrant.${key}`),
        color: SEGMENT_COLORS[key],
      })),
    [t],
  )

  if (total <= 0) return <span className="text-slate-300">—</span>

  const pct = (value: number) => (value / total) * 100

  return (
    <Tooltip
      title={
        <div className="space-y-1">
          {segments.map((seg) => {
            const value = quadrant[seg.key]
            return (
              <div key={seg.key} className="flex items-center gap-2 whitespace-nowrap">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: seg.color }}
                  aria-hidden
                />
                <span className="flex-1">{seg.label}</span>
                <span className="tabular-nums font-medium">
                  {value} ({pct(value).toFixed(1)}%)
                </span>
              </div>
            )
          })}
        </div>
      }
    >
      <div
        className="flex h-2.5 w-full min-w-[120px] overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={t('quadrant.ariaLabel', { total })}
      >
        {segments.map((seg) => {
          const value = quadrant[seg.key]
          if (value <= 0) return null
          return (
            <div
              key={seg.key}
              style={{ width: `${pct(value)}%`, backgroundColor: seg.color }}
              aria-hidden
            />
          )
        })}
      </div>
    </Tooltip>
  )
}

export function QuadrantLegend() {
  const { t } = useTranslation('dispatchPerformance')

  const segments = useMemo(
    () =>
      SEGMENT_KEYS.map((key) => ({
        key,
        label: t(`quadrant.${key}`),
        color: SEGMENT_COLORS[key],
      })),
    [t],
  )

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      {segments.map((seg) => (
        <span key={seg.key} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: seg.color }}
            aria-hidden
          />
          {seg.label}
        </span>
      ))}
    </div>
  )
}
