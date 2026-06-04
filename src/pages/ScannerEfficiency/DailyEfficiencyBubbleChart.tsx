import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { formatCainiaoSharePercent } from './cainiaoWaybill'
import { formatInteger } from './formatAndParse'

export type DailyEfficiencyBubbleDatum = {
  date: string
  sorterCount: number
  volume: number
  cainiaoVolume: number
  /** 0–1；无到件时为 null */
  cainiaoShare: number | null
  efficiency: number
  totalHours: number
  costPerTicket: number | null
}

type VolumeStackRow = {
  date: string
  segment: '菜鸟' | '其他'
  value: number
  volume: number
  cainiaoVolume: number
  otherVolume: number
  cainiaoShare: number | null
  totalHours: number
  costPerTicket: number | null
}

type Props = {
  data: DailyEfficiencyBubbleDatum[]
  className?: string
}

const BAR_CAINIAO_COLOR = '#f97316'
const BAR_OTHER_COLOR = '#3b82f6'
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

function buildDayTooltipHtml(date: string, day: DailyEfficiencyBubbleDatum | undefined): string {
  const rowStyle =
    'display:flex;justify-content:space-between;gap:16px;line-height:1.55;font-size:12px;'
  const labelStyle = 'color:#64748b'
  const valueStyle = 'font-weight:500;color:#0f172a;tabular-nums'

  const row = (label: string, value: string) =>
    `<div style="${rowStyle}"><span style="${labelStyle}">${label}</span><span style="${valueStyle}">${value}</span></div>`

  if (!day) {
    return `<div style="padding:8px 12px;"><div style="font-weight:600;color:#0f172a">${date}</div></div>`
  }

  const cainiao = Math.max(0, Math.round(day.cainiaoVolume))
  const other = Math.max(0, day.volume - cainiao)
  const lines = [
    row('菜鸟', `${formatInteger(cainiao)} 票`),
    row('其他', `${formatInteger(other)} 票`),
    row('菜鸟占比', formatCainiaoSharePercent(day.cainiaoShare)),
    row('总工时', `${fmt1(day.totalHours)} h`),
    row('当天效率', `${fmt1(day.efficiency)} 票/h`),
  ]
  if (day.costPerTicket != null && Number.isFinite(day.costPerTicket)) {
    lines.push(row('单位成本', `$${day.costPerTicket.toFixed(2)}`))
  }

  return `<div style="padding:8px 12px;min-width:148px;"><div style="font-weight:600;margin-bottom:6px;color:#0f172a;font-size:12px;">${date}</div>${lines.join('')}</div>`
}

function buildVolumeStackData(data: DailyEfficiencyBubbleDatum[]): VolumeStackRow[] {
  const rows: VolumeStackRow[] = []
  for (const d of data) {
    const cainiao = Math.max(0, Math.round(d.cainiaoVolume))
    const other = Math.max(0, d.volume - cainiao)
    const base = {
      date: d.date,
      volume: d.volume,
      cainiaoVolume: cainiao,
      otherVolume: other,
      cainiaoShare: d.cainiaoShare,
      totalHours: d.totalHours,
      costPerTicket: d.costPerTicket,
    }
    rows.push({ ...base, segment: '菜鸟', value: cainiao })
    rows.push({ ...base, segment: '其他', value: other })
  }
  return rows
}

export default function DailyEfficiencyComboChart({ data, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const volumeStackData = useMemo(() => buildVolumeStackData(data), [data])

  const dataKey = useMemo(
    () =>
      data
        .map(
          (d) =>
            `${d.date}\t${d.volume}\t${d.cainiaoVolume}\t${d.totalHours}\t${d.efficiency}\t${d.costPerTicket ?? ''}\t${d.cainiaoShare ?? ''}`,
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
    const dayByDate = new Map(data.map((d) => [d.date, d]))

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

    chart.interaction('tooltip', {
      shared: true,
      render: (_event, { title }) => {
        const date = String(title ?? '')
        return buildDayTooltipHtml(date, dayByDate.get(date))
      },
    })

    chart.scale('x', { type: 'band', paddingInner: 0.4, paddingOuter: 0.1 })
    chart.scale('color', {
      domain: ['菜鸟', '其他'],
      range: [BAR_CAINIAO_COLOR, BAR_OTHER_COLOR],
    })

    // ── 货量堆叠柱：菜鸟 + 其他（左轴）
    chart
      .interval()
      .data(volumeStackData)
      .encode('x', 'date')
      .encode('y', 'value')
      .encode('color', 'segment')
      .transform({ type: 'stackY' })
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
      .style('fillOpacity', 0.88)
      .style('radiusTopLeft', 2)
      .style('radiusTopRight', 2)
      .tooltip({
        title: { field: 'date' },
        items: false,
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
  }, [data, dataKey, skipChart, volumeStackData])

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
            <span className="h-3 w-3 rounded-sm" style={{ background: BAR_CAINIAO_COLOR }} aria-hidden />
            菜鸟货量
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: BAR_OTHER_COLOR }} aria-hidden />
            其他货量
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-0.5 w-5 rounded"
              style={{ background: AREA_HOURS_COLOR, borderBottom: `2px dashed ${AREA_HOURS_COLOR}` }}
              aria-hidden
            />
            总工时
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded" style={{ background: LINE_EFF_COLOR }} aria-hidden />
            当天效率（右轴，橙线）
          </span>
        </div>
      </div>
      <div
        ref={containerRef}
        className="g2-daily-efficiency-combo min-h-[280px] w-full"
        role="img"
        aria-label="按日效率综合图：左轴堆叠柱为菜鸟与其他货量，绿色面积总工时，橙线当天效率，悬停显示明细"
      />
    </div>
  )
}
