import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { adminColors } from '../../../theme/adminColors'
import { ratePct, type ExitRateDimRow } from '../exitRateQueryApi'

type Props = {
  rows: ExitRateDimRow[]
  selectedKey: string | null
  onSelect: (key: string) => void
}

type Bar = { key: string; label: string; bucket: string; pct: number; count: number }

/** 一组 4 根柱：组宽越大柱越粗，柱多了横向滚动 */
const GROUP_WIDTH = 96
const CHART_HEIGHT = 420

/**
 * 维度出仓率分组柱状图：一组一个供应商 / 路由 / 司机，四根柱 = 当天 / 次日 0–11 / 超期 / 未出仓。
 * 四根柱同一基线，所以「当天 vs 次日」谁高谁低可以直接比高度（堆叠图做不到这点）。
 * 组按「当天 + 次日」合计达成率升序，最差的排最左边；轴标签括号内是到件量。
 */
export function DimRateBarChart({ rows, selectedKey, onSelect }: Props) {
  const { t } = useTranslation('exitRateQuery')
  const containerRef = useRef<HTMLDivElement>(null)

  const { bars, labels, buckets } = useMemo(() => {
    const buckets = [t('dim.sameDay'), t('dim.nextMorning'), t('chart.late'), t('dim.pending')]
    const ordered = rows
      .filter((row) => row.total > 0)
      .map((row) => ({
        row,
        late: Math.max(0, row.total - row.sameDay - row.nextMorning - row.pending),
        cum: (row.sameDay + row.nextMorning) / row.total,
      }))
      .sort((a, b) => a.cum - b.cum || b.row.total - a.row.total)

    const used = new Set<string>()
    const bars: Bar[] = []
    const labels: string[] = []
    for (const { row, late } of ordered) {
      let label = `${row.name || t('dim.unassigned')} (${row.total})`
      while (used.has(label)) label += ' ' // 同名不同 key：补空格保证 band 域唯一
      used.add(label)
      labels.push(label)
      const counts = [row.sameDay, row.nextMorning, late, row.pending]
      counts.forEach((count, i) => {
        bars.push({
          key: row.key,
          label,
          bucket: buckets[i],
          pct: ratePct(count, row.total) ?? 0,
          count,
        })
      })
    }
    return { bars, labels, buckets }
  }, [rows, t])

  const dataKey = bars.map((b) => `${b.label}\t${b.bucket}\t${b.count}`).join('|')
  const minWidth = Math.max(640, labels.length * GROUP_WIDTH)

  useEffect(() => {
    const el = containerRef.current
    if (!el || bars.length === 0) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: CHART_HEIGHT,
      theme: 'light',
      paddingTop: 44,
      paddingRight: 24,
      paddingBottom: 132,
      paddingLeft: 56,
    })

    chart.scale('x', { type: 'band', domain: labels, paddingInner: 0.18 })
    chart.scale('y', { domainMin: 0, domainMax: 100 })
    chart.scale('color', {
      type: 'ordinal',
      domain: buckets,
      range: [adminColors.accent, '#d97706', '#94a3b8', '#e11d48'],
    })
    chart.legend('color', { position: 'top' })
    chart.axis('x', {
      title: false,
      labelFontSize: 11,
      labelAutoHide: false,
      labelAutoRotate: true,
      labelTransform: 'rotate(-40)',
    })
    chart.axis('y', {
      title: false,
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: adminColors.line,
      labelFormatter: (value: string) => `${value}%`,
    })
    chart.interaction('tooltip', { shared: true })

    chart
      .interval()
      .data(bars)
      .transform({ type: 'dodgeX', padding: 0.04 })
      .encode('x', 'label')
      .encode('y', 'pct')
      .encode('color', 'bucket')
      .style('fillOpacity', (d: Bar) => (selectedKey && d.key !== selectedKey ? 0.3 : 0.95))
      .label({
        text: (d: Bar) => (d.pct >= 2 ? `${d.pct.toFixed(0)}%` : ''),
        position: 'top',
        dy: -2,
        fontSize: 10,
        fill: adminColors.muted,
      })
      .tooltip({
        title: (d: Bar) => d.label,
        items: [
          {
            channel: 'y',
            valueFormatter: (v: number) => `${v.toFixed(1)}%`,
          },
        ],
      })

    chart.on('element:click', (event: { data?: { data?: Bar } }) => {
      const key = event.data?.data?.key
      if (key != null) onSelect(key)
    })

    void chart.render()
    return () => {
      chart.destroy()
    }
  }, [bars, buckets, dataKey, labels, onSelect, selectedKey])

  if (bars.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-md border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface-soft)] text-sm text-slate-500">
        {t('chart.empty')}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        <div ref={containerRef} role="img" aria-label={t('chart.barTitle')} />
      </div>
    </div>
  )
}
