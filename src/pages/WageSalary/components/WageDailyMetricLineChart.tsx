import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

type Point = { date: string; value: number }

type Props = {
  points: Point[]
  yTitle: string
  legendLabel: string
  stroke: string
  ariaLabel: string
  className?: string
}

export function WageDailyMetricLineChart({
  points,
  yTitle,
  legendLabel,
  stroke,
  ariaLabel,
  className,
}: Props) {
  const { t } = useTranslation('wageSalary')
  const containerRef = useRef<HTMLDivElement>(null)
  const skipChart = !points.length
  const pointsKey = useMemo(
    () => points.map((p) => `${p.date}\t${p.value}`).join('|'),
    [points],
  )

  useEffect(() => {
    if (skipChart) return
    const el = containerRef.current
    if (!el) return

    const data = points.map((p) => ({ date: p.date, value: Number(p.value) || 0 }))

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: 240,
      theme: 'light',
      paddingTop: 12,
      paddingRight: 8,
      paddingBottom: 28,
      paddingLeft: 52,
    })

    chart.scale('x', { type: 'point', padding: 0.35 })
    chart.scale('y', { type: 'linear', nice: true, domainMin: 0 })

    chart.axis('x', {
      labelAutoHide: true,
      labelFormatter: (v: string) => (v.length >= 10 ? v.slice(5) : v),
    })
    chart.axis('y', {
      title: yTitle,
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: '#e2e8f0',
    })

    chart.interaction('tooltip', true)

    chart
      .line()
      .data(data)
      .encode('x', 'date')
      .encode('y', 'value')
      .style('stroke', stroke)
      .style('lineWidth', 2)

    chart
      .point()
      .data(data)
      .encode('x', 'date')
      .encode('y', 'value')
      .style('fill', stroke)
      .style('stroke', '#fff')
      .style('lineWidth', 1)
      .style('r', 3.5)

    void chart.render()

    return () => {
      chart.destroy()
    }
  }, [skipChart, points, pointsKey, stroke, yTitle])

  if (skipChart) {
    return (
      <div
        className={[
          'flex min-h-[200px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/80 text-sm text-slate-500',
          className ?? '',
        ].join(' ')}
      >
        {t('charts.noDailyData')}
      </div>
    )
  }

  return (
    <div className={className ?? ''}>
      <div className="mb-2 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-full" style={{ backgroundColor: stroke }} />
          {legendLabel}
        </span>
      </div>
      <div ref={containerRef} className="g2-wage-daily-line min-h-[220px] w-full" role="img" aria-label={ariaLabel} />
    </div>
  )
}
