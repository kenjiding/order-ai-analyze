import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'

export type DailyEfficiencyBubbleDatum = {
  date: string
  sorterCount: number
  volume: number
  efficiency: number
  totalHours: number
  costPerTicket: number | null
}

type Props = {
  data: DailyEfficiencyBubbleDatum[]
  className?: string
}

const BAR_VOLUME_COLOR = '#3b82f6'
const AREA_HOURS_COLOR = '#14b8a6'
const LINE_EFF_COLOR = '#f97316'

function hasAnyPoint(data: DailyEfficiencyBubbleDatum[]) {
  return data.some((d) => Number.isFinite(d.efficiency))
}

function fmt1(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

export default function DailyEfficiencyComboChart({ data, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const dataKey = useMemo(
    () =>
      data
        .map(
          (d) =>
            `${d.date}\t${d.volume}\t${d.totalHours}\t${d.efficiency}\t${d.costPerTicket ?? ''}`,
        )
        .join('|'),
    [data],
  )

  const skipChart = !data.length || !hasAnyPoint(data)

  useEffect(() => {
    if (skipChart) return
    const el = containerRef.current
    if (!el) return

    const effData = data.filter((d) => Number.isFinite(d.efficiency))

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: 320,
      theme: 'light',
      paddingTop: 20,
      paddingRight: 72,
      paddingBottom: 50,
      paddingLeft: 56,
    })

    chart.interaction('tooltip', { shared: true })

    // 让日期字符串按 band 分布，并留出柱间空隙
    chart.scale('x', { type: 'band', paddingInner: 0.4, paddingOuter: 0.1 })

    // ── 总货量柱（左轴）
    chart
      .interval()
      .data(data)
      .encode('x', 'date')
      .encode('y', 'volume')
      .axis('x', {
        title: null,
        labelAutoRotate: true,
        labelAutoHide: true,
        labelFontSize: 11,
      })
      .axis('y', {
        title: '总货量（票）',
        titleFontSize: 11,
        grid: true,
        gridLineDash: [4, 4],
        gridStroke: '#e2e8f0',
        domainMin: 0,
        nice: true,
      })
      .style('fill', BAR_VOLUME_COLOR)
      .style('fillOpacity', 0.8)
      .style('radiusTopLeft', 2)
      .style('radiusTopRight', 2)
      .tooltip({
        title: { field: 'date' },
        items: [
          {
            field: 'volume',
            name: '总货量',
            valueFormatter: (v: number) => `${v} 票`,
          },
          {
            field: 'totalHours',
            name: '总工时',
            valueFormatter: (v: number) => `${fmt1(v)} h`,
          },
          {
            field: 'costPerTicket',
            name: '每票成本',
            valueFormatter: (v: number | null) =>
              v != null && Number.isFinite(v) ? `$${v.toFixed(2)}/票` : '—',
          },
        ],
      })

    // ── 总工时面积（独立比例尺，自适应高度，右侧隐藏轴）
    chart
      .area()
      .data(data)
      .encode('x', 'date')
      .encode('y', 'totalHours')
      .encode('y1', 0)
      .scale('y', { independent: true, nice: true, domainMin: 0 })
      .axis('y', false)
      .style('fill', AREA_HOURS_COLOR)
      .style('fillOpacity', 0.18)
      .style('lineWidth', 0)
      .tooltip(false)

    // ── 总工时折线（与面积共享独立比例尺）
    chart
      .line()
      .data(data)
      .encode('x', 'date')
      .encode('y', 'totalHours')
      .scale('y', { independent: true, nice: true, domainMin: 0 })
      .axis('y', false)
      .style('stroke', AREA_HOURS_COLOR)
      .style('lineWidth', 2)
      .style('lineDash', [4, 3])
      .tooltip(false)

    // ── 当天效率折线（右轴，独立比例尺）
    chart
      .line()
      .data(effData)
      .encode('x', 'date')
      .encode('y', 'efficiency')
      .scale('y', { independent: true, nice: true, domainMin: 0 })
      .axis('y', {
        position: 'right',
        title: '当天效率（票/h）',
        titleFontSize: 11,
        labelFontSize: 11,
        labelFormatter: (v: string | number) => fmt1(typeof v === 'number' ? v : Number(v)),
        grid: false,
      })
      .style('stroke', LINE_EFF_COLOR)
      .style('lineWidth', 2.5)
      .tooltip(false)

    // ── 效率散点（右轴，与折线共享独立比例尺）
    chart
      .point()
      .data(effData)
      .encode('x', 'date')
      .encode('y', 'efficiency')
      .encode('shape', 'circle')
      .scale('y', { independent: true, nice: true, domainMin: 0 })
      .axis('y', false)
      .style('fill', LINE_EFF_COLOR)
      .style('stroke', '#fff')
      .style('lineWidth', 1.5)
      .style('r', 5)
      .label({
        text: (d: DailyEfficiencyBubbleDatum) => fmt1(d.efficiency),
        position: 'top',
        style: { fontSize: 10, fontWeight: 600, fill: '#c2410c' },
        dy: -8,
      })
      .tooltip(false)

    void chart.render()

    return () => {
      chart.destroy()
    }
  }, [data, dataKey, skipChart])

  if (!data.length) {
    return (
      <div
        className={[
          'flex min-h-[220px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/80 text-sm text-slate-500',
          className ?? '',
        ].join(' ')}
      >
        暂无日期匹配数据。
      </div>
    )
  }

  if (!hasAnyPoint(data)) {
    return (
      <div
        className={[
          'flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-200 bg-slate-50/80 px-4 text-center text-sm text-slate-500',
          className ?? '',
        ].join(' ')}
      >
        <span>暂无有效「当天效率」数据点（均为空或未匹配工时）。</span>
      </div>
    )
  }

  return (
    <div className={className ?? ''}>
      <div className="mb-2 space-y-1 text-xs font-medium text-slate-600">
        <div className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: BAR_VOLUME_COLOR }} aria-hidden />
            总货量（左轴，蓝色柱）
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-0.5 w-5 rounded"
              style={{ background: AREA_HOURS_COLOR, borderBottom: `2px dashed ${AREA_HOURS_COLOR}` }}
              aria-hidden
            />
            总工时（独立比例尺，绿虚线+面积）
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded" style={{ background: LINE_EFF_COLOR }} aria-hidden />
            当天效率（右轴，橙线）
          </span>
        </div>
        <div className="text-[11px] font-normal text-slate-400">
          总工时面积与货量柱各自独立缩放，便于对比趋势；悬停可查看精确数值及每票成本。
        </div>
      </div>
      <div
        ref={containerRef}
        className="g2-daily-efficiency-combo min-h-[280px] w-full"
        role="img"
        aria-label="按日效率综合图：蓝柱总货量（左轴），绿色面积总工时（独立比例尺），橙线当天效率（右轴），悬停显示每票成本"
      />
    </div>
  )
}
