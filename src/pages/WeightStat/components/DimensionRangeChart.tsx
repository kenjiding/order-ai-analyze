import { Chart } from '@antv/g2'
import { Empty } from 'antd'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { adminColors } from '../../../theme/adminColors'
import type { DimensionRangeRow } from '../weightStatApi'

type Props = {
  rows: DimensionRangeRow[]
  topN?: number
}

type Point = {
  label: string
  rangeLabel: string
  count: number
  pct: number
}

export const DIMENSION_CHART_TOP_N = 12

/**
 * 分组柱（不堆叠）：用户添加的区间可能重叠（同一单落在多个区间），堆叠会把总高度算错，
 * 分组并排才不管区间是否重叠都能画对。
 */
export function DimensionRangeChart({ rows, topN = DIMENSION_CHART_TOP_N }: Props) {
  const { t } = useTranslation('weightStat')
  const containerRef = useRef<HTMLDivElement>(null)

  const data = useMemo<Point[]>(() => {
    const top = rows.slice(0, topN)
    const out: Point[] = []
    for (const row of top) {
      const label = row.label || t('dimension.unassigned')
      for (const cell of row.cells) {
        out.push({ label, rangeLabel: `[${cell.min}, ${cell.max}]`, count: cell.count, pct: cell.pct })
      }
    }
    return out
  }, [rows, topN, t])

  const dataKey = data.map((d) => `${d.label}:${d.rangeLabel}:${d.count}`).join('|')
  const groupCount = new Set(data.map((d) => d.label)).size
  const height = Math.min(520, Math.max(220, 60 + groupCount * 42))

  useEffect(() => {
    const el = containerRef.current
    if (!el || data.length === 0) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height,
      theme: 'light',
      paddingTop: 16,
      paddingRight: 24,
      paddingBottom: 48,
      paddingLeft: 140,
    })

    chart.scale('x', { type: 'band', paddingInner: 0.3 })
    chart.scale('y', { type: 'linear', nice: true, domainMin: 0 })
    chart.axis('x', { title: false, labelFontSize: 11 })
    chart.axis('y', {
      title: t('dimension.axisCount'),
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: adminColors.line,
    })
    chart.legend('color', { position: 'top' })
    chart.interaction('tooltip', { shared: true })

    const interval = chart.interval()
    interval.coordinate({ transform: [{ type: 'transpose' }] })
    interval
      .data(data)
      .transform({ type: 'dodgeX' })
      .encode('x', 'label')
      .encode('y', 'count')
      .encode('color', 'rangeLabel')
      .style('fillOpacity', 0.88)
      .style('radius', 2)
      .tooltip({
        title: (d: Point) => d.label,
        items: [
          { name: t('dimension.tooltipRange'), field: 'rangeLabel' },
          { name: t('dimension.tooltipCount'), field: 'count' },
          { name: t('dimension.tooltipPct'), field: 'pct', valueFormatter: (v: number) => `${v.toFixed(1)}%` },
        ],
      })

    void chart.render()
    return () => chart.destroy()
  }, [dataKey, data, height, t])

  if (data.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dimension.empty')} />
  }

  return <div ref={containerRef} role="img" aria-label={t('dimension.title')} />
}
