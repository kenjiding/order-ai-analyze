import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { adminColors } from '../../../theme/adminColors'
import { HOUR_SLOT_COUNT, ratePct } from '../exitRateQueryApi'

type Props = {
  byHour: number[]
  total: number
  title: string
}

type Point = {
  shortLabel: string
  label: string
  incremental: number
  cumulative: number
  count: number
  bucket: string
}

function hourSlotLabel(
  index: number,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const hour = index < 24 ? index : index - 24
  const start = String(hour).padStart(2, '0')
  const end = String(hour + 1).padStart(2, '0')
  return t(index < 24 ? 'hourly.sameDay' : 'hourly.nextDay', { start, end })
}

export function HourlyExitChart({ byHour, total, title }: Props) {
  const { t } = useTranslation('exitRateQuery')
  const containerRef = useRef<HTMLDivElement>(null)

  const points = useMemo<Point[]>(() => {
    const hours = byHour.length === HOUR_SLOT_COUNT ? byHour : Array.from({ length: HOUR_SLOT_COUNT }, (_, i) => byHour[i] ?? 0)
    let cum = 0
    return hours.map((count, index) => {
      cum += count
      return {
        shortLabel: index < 24 ? String(index).padStart(2, '0') : `+${String(index - 24).padStart(2, '0')}`,
        label: hourSlotLabel(index, t),
        incremental: ratePct(count, total) ?? 0,
        cumulative: ratePct(cum, total) ?? 0,
        count,
        bucket: index < 24 ? t('kpi.sameDay') : t('kpi.nextMorning'),
      }
    })
  }, [byHour, t, total])

  const dataKey = points.map((p) => `${p.count}:${p.cumulative.toFixed(2)}`).join('|')

  useEffect(() => {
    const el = containerRef.current
    if (!el || total <= 0) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: 280,
      theme: 'light',
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 48,
      paddingLeft: 52,
    })

    chart.scale('x', { type: 'band', paddingInner: 0.18 })
    chart.scale('y', { nice: true, domainMin: 0, domainMax: 100 })
    chart.scale('color', {
      type: 'ordinal',
      domain: [t('kpi.sameDay'), t('kpi.nextMorning')],
      range: [adminColors.accent, '#d97706'],
    })
    chart.legend('color', { position: 'top' })
    chart.axis('x', {
      title: false,
      labelAutoHide: true,
      labelAutoRotate: true,
      labelFontSize: 10,
    })
    chart.axis('y', {
      title: t('hourly.axisPercent'),
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: adminColors.line,
      labelFormatter: (value: string) => `${value}%`,
    })
    chart.interaction('tooltip', { shared: true })

    chart
      .interval()
      .data(points)
      .encode('x', 'shortLabel')
      .encode('y', 'incremental')
      .encode('color', 'bucket')
      .style('radiusTopLeft', 2)
      .style('radiusTopRight', 2)
      .tooltip({
        title: (d: Point) => d.label,
        items: [
          {
            name: t('hourly.incremental'),
            field: 'incremental',
            valueFormatter: (v: number) => `${v.toFixed(1)}%`,
          },
          { name: t('hourly.count'), field: 'count' },
        ],
      })

    chart
      .line()
      .data(points)
      .encode('x', 'shortLabel')
      .encode('y', 'cumulative')
      .style('stroke', adminColors.text)
      .style('lineWidth', 2)
      .tooltip({
        items: [
          {
            name: t('hourly.cumulative'),
            field: 'cumulative',
            valueFormatter: (v: number) => `${v.toFixed(1)}%`,
          },
        ],
      })

    void chart.render()
    return () => chart.destroy()
  }, [dataKey, points, t, total])

  if (total <= 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-md border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface-soft)] text-sm text-slate-500">
        {t('hourly.empty')}
      </div>
    )
  }

  return <div ref={containerRef} role="img" aria-label={title} />
}
