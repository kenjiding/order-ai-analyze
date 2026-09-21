import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  formatPct,
  MATRIX_NEXT_DAY_HOURS,
  nextDayHourSlotIndex,
  ratePct,
  type ExitRateDimRow,
} from '../exitRateQueryApi'

type Props = {
  rows: ExitRateDimRow[]
  selectedKey: string | null
  onSelect: (key: string) => void
}

type Cell = { key: string; label: string; hour: string; pct: number; count: number }

const ROW_HEIGHT = 24

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}–${String(hour + 1).padStart(2, '0')}`
}

/**
 * 次日 7–11 点出仓热力图：行 = 供应商 / 路由 / 司机，列 = 小时段，色深 = 该时段出仓占该行到件量的比例。
 * 列头括号内是该时段的整体占比（当前所有行合计），行内看个体、列头看大盘。
 * 越靠上、颜色越深 = 货压到次日上午才出仓，正是要追的行。
 */
export function NextDayHourHeatmap({ rows, selectedKey, onSelect }: Props) {
  const { t } = useTranslation('exitRateQuery')
  const containerRef = useRef<HTMLDivElement>(null)

  const { cells, labels, hours } = useMemo(() => {
    const valid = rows.filter((row) => row.total > 0)
    const grandTotal = valid.reduce((sum, row) => sum + row.total, 0)
    const hourText = new Map<number, string>()
    for (const hour of MATRIX_NEXT_DAY_HOURS) {
      const met = valid.reduce(
        (sum, row) => sum + (row.byHour?.[nextDayHourSlotIndex(hour)] ?? 0),
        0,
      )
      hourText.set(hour, `${hourLabel(hour)} (${formatPct(ratePct(met, grandTotal))})`)
    }
    const hours = MATRIX_NEXT_DAY_HOURS.map((hour) => hourText.get(hour) ?? hourLabel(hour))

    const ordered = valid
      .map((row) => {
        const met = MATRIX_NEXT_DAY_HOURS.reduce(
          (sum, hour) => sum + (row.byHour?.[nextDayHourSlotIndex(hour)] ?? 0),
          0,
        )
        return { row, share: met / row.total }
      })
      .sort((a, b) => b.share - a.share || b.row.total - a.row.total)

    const used = new Set<string>()
    const cells: Cell[] = []
    const labels: string[] = []
    for (const { row } of ordered) {
      let label = `${row.name || t('dim.unassigned')} (${row.total})`
      while (used.has(label)) label += ' ' // 同名不同 key：补空格保证 band 域唯一
      used.add(label)
      labels.push(label)
      for (const hour of MATRIX_NEXT_DAY_HOURS) {
        const count = row.byHour?.[nextDayHourSlotIndex(hour)] ?? 0
        cells.push({
          key: row.key,
          label,
          hour: hourText.get(hour) ?? hourLabel(hour),
          pct: ratePct(count, row.total) ?? 0,
          count,
        })
      }
    }
    return { cells, labels, hours }
  }, [rows, t])

  const dataKey = cells.map((c) => `${c.label}\t${c.hour}\t${c.count}`).join('|')
  const height = 56 + labels.length * ROW_HEIGHT

  useEffect(() => {
    const el = containerRef.current
    if (!el || cells.length === 0) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height,
      theme: 'light',
      paddingTop: 8,
      paddingRight: 84,
      paddingBottom: 36,
      paddingLeft: 168,
    })

    chart.scale('x', { type: 'band', domain: hours })
    chart.scale('y', { type: 'band', domain: labels })
    chart.scale('color', { type: 'sequential', palette: 'oranges', domainMin: 0 })
    chart.axis('x', { title: false, position: 'top', labelFontSize: 11 })
    chart.axis('y', { title: false, labelFontSize: 11 })
    chart.legend('color', { position: 'right', title: t('chart.heatLegend') })
    chart.interaction('tooltip', true)

    chart
      .cell()
      .data(cells)
      .encode('x', 'hour')
      .encode('y', 'label')
      .encode('color', 'pct')
      .style('inset', 1)
      .style('radius', 2)
      .style('fillOpacity', (d: Cell) => (selectedKey && d.key !== selectedKey ? 0.3 : 1))
      .tooltip({
        title: (d: Cell) => `${d.label} · ${d.hour}`,
        items: [
          {
            name: t('chart.heatLegend'),
            field: 'pct',
            valueFormatter: (v: number) => `${v.toFixed(1)}%`,
          },
          { name: t('hourly.count'), field: 'count' },
        ],
      })

    chart
      .text()
      .data(cells)
      .encode('x', 'hour')
      .encode('y', 'label')
      .encode('text', (d: Cell) => (d.count === 0 ? '' : `${d.pct.toFixed(0)}%`))
      .style('fontSize', 10)
      .style('fill', '#1f2937')
      .tooltip(false)

    chart.on('element:click', (event: { data?: { data?: Cell } }) => {
      const key = event.data?.data?.key
      if (key != null) onSelect(key)
    })

    void chart.render()
    return () => {
      chart.destroy()
    }
  }, [cells, dataKey, height, hours, labels, onSelect, selectedKey, t])

  if (cells.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-md border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface-soft)] text-sm text-slate-500">
        {t('chart.empty')}
      </div>
    )
  }

  return (
    <div className="max-h-[560px] overflow-y-auto">
      <div ref={containerRef} role="img" aria-label={t('chart.heatTitle')} />
    </div>
  )
}
