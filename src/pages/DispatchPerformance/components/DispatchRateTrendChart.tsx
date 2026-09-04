import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { adminColors } from '../../../theme/adminColors'

type Series = {
  key: string
  label: string
  color: string
}

type Point = {
  date: string
  seriesKey: string
  rate: number | null
}

type Props = {
  dates: string[]
  series: Series[]
  points: Point[]
  yTitle: string
  ariaLabel: string
  emptyText: string
}

type Row = {
  date: string
  seriesLabel: string
  rate: number
}

const HEIGHT = 300

export function DispatchRateTrendChart({ dates, series, points, yTitle, ariaLabel, emptyText }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const { rows, domain, range } = useMemo(() => {
    const labelByKey = new Map(series.map((item) => [item.key, item.label]))
    const list: Row[] = []
    for (const point of points) {
      if (point.rate == null) continue
      const label = labelByKey.get(point.seriesKey)
      if (!label) continue
      list.push({ date: point.date, seriesLabel: label, rate: point.rate })
    }
    return {
      rows: list,
      domain: series.map((item) => item.label),
      range: series.map((item) => item.color),
    }
  }, [points, series])

  const rowsKey = useMemo(
    () => rows.map((row) => `${row.date}\t${row.seriesLabel}\t${row.rate}`).join('|'),
    [rows],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el || rows.length === 0 || dates.length === 0) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: HEIGHT,
      theme: 'light',
      paddingTop: 12,
      paddingRight: 16,
      paddingBottom: 30,
      paddingLeft: 58,
    })

    chart.scale('x', { type: 'point', domain: dates, padding: 0.35 })
    chart.scale('y', { nice: true, domainMin: 0, domainMax: 100 })
    chart.scale('color', { type: 'ordinal', domain, range })
    chart.legend(false)
    chart.axis('x', {
      title: false,
      labelAutoHide: true,
      labelAutoRotate: false,
      labelFormatter: (value: string) => (value.length >= 10 ? value.slice(5) : value),
    })
    chart.axis('y', {
      title: yTitle,
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: adminColors.line,
      labelFormatter: (value: string) => `${value}%`,
    })
    chart.interaction('tooltip', { shared: true })

    chart
      .line()
      .data(rows)
      .encode('x', 'date')
      .encode('y', 'rate')
      .encode('color', 'seriesLabel')
      .style('lineWidth', 2.2)
      .style('lineCap', 'round')
      .style('lineJoin', 'round')
    chart
      .point()
      .data(rows)
      .encode('x', 'date')
      .encode('y', 'rate')
      .encode('color', 'seriesLabel')
      .encode('shape', 'point')
      .style('r', 2.8)
      .tooltip(false)

    void chart.render()
    return () => chart.destroy()
  }, [dates, domain, range, rows, rowsKey, yTitle])

  if (dates.length === 0 || rows.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-md border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface-soft)] text-sm text-slate-500">
        {emptyText}
      </div>
    )
  }

  return <div ref={containerRef} role="img" aria-label={ariaLabel} />
}
