import { useTranslation } from 'react-i18next'
import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'

type DailyTrendPoint = {
  date: string
  value: number | null
}

type Props = {
  points: DailyTrendPoint[]
  variant: 'volume' | 'sortingEfficiency'
  className?: string
}

const CHART_COLORS = {
  volume: { stroke: '#2f8f87', fill: '#2f8f87' },
  sortingEfficiency: { stroke: '#1d4ed8', fill: '#1d4ed8' },
} as const

function splitEfficiencySegments(points: DailyTrendPoint[]): { date: string; value: number }[][] {
  const runs: { date: string; value: number }[][] = []
  let run: { date: string; value: number }[] = []
  for (const p of points) {
    if (p.value != null && Number.isFinite(p.value)) {
      run.push({ date: p.date, value: p.value })
    } else if (run.length) {
      runs.push(run)
      run = []
    }
  }
  if (run.length) runs.push(run)
  return runs
}

export default function DailyTrendLineChart({ points, variant, className }: Props) {
  const { t } = useTranslation('scannerEfficiency')
  const containerRef = useRef<HTMLDivElement>(null)
  const s = useMemo(() => {
    const colors = CHART_COLORS[variant]
    if (variant === 'volume') {
      return {
        ...colors,
        legend: t('chart.volumeLegend'),
        empty: t('chart.volumeEmpty'),
        yTitle: t('chart.volumeYTitle'),
        aria: t('chart.volumeAria'),
      }
    }
    return {
      ...colors,
      legend: t('chart.sortingLegend'),
      empty: t('chart.sortingEmpty'),
      yTitle: t('chart.sortingYTitle'),
      aria: t('chart.sortingAria'),
    }
  }, [t, variant])

  const skipChart = !points.length

  const pointsKey = useMemo(
    () => points.map((p) => `${p.date}\t${p.value ?? '∅'}`).join('|'),
    [points],
  )

  useEffect(() => {
    if (skipChart) return
    const el = containerRef.current
    if (!el) return

    const cfg = s

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: 250,
      theme: 'light',
      paddingTop: 12,
      paddingRight: 6,
      paddingBottom: 22,
      paddingLeft: 56,
    })

    chart.scale('x', { type: 'point', padding: 0.4 })
    chart.scale('y', {
      nice: true,
      domainMin: 0,
    })

    chart.axis('x', {
      labelAutoHide: true,
      labelAutoRotate: false,
      labelFormatter: (v: string) => (v.length >= 10 ? v.slice(5) : v),
    })
    chart.axis('y', {
      title: cfg.yTitle,
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: '#e2e8f0',
    })

    chart.interaction('tooltip', true)

    if (variant === 'volume') {
      const data = points.map((p) => ({ date: p.date, value: Number(p.value ?? 0) }))
      chart
        .area()
        .data(data)
        .encode('x', 'date')
        .encode('y', 'value')
        .style('fill', cfg.fill)
        .style('fillOpacity', 0.16)
      chart
        .line()
        .data(data)
        .encode('x', 'date')
        .encode('y', 'value')
        .style('stroke', cfg.stroke)
        .style('lineWidth', 2.5)
        .style('lineCap', 'round')
        .style('lineJoin', 'round')
    } else {
      const segments = splitEfficiencySegments(points)
      for (const seg of segments) {
        chart
          .line()
          .data(seg)
          .encode('x', 'date')
          .encode('y', 'value')
          .style('stroke', cfg.stroke)
          .style('lineWidth', 2.25)
          .style('lineCap', 'round')
          .style('lineJoin', 'round')
      }
    }

    void chart.render()

    return () => {
      chart.destroy()
    }
  }, [skipChart, variant, pointsKey, points, s])

  if (!points.length) {
    return (
      <div
        className={[
          'flex min-h-[220px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/80 text-sm text-slate-500',
          className ?? '',
        ].join(' ')}
      >
        {s.empty}
      </div>
    )
  }

  return (
    <div className={className ?? ''}>
      <div className="mb-3 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-full" style={{ backgroundColor: s.stroke }} />
          {s.legend}
        </span>
      </div>
      <div
        ref={containerRef}
        className="g2-daily-trend min-h-[220px] w-full"
        role="img"
        aria-label={s.aria}
      />
    </div>
  )
}
