import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import {
  isScannerTotalEfficiencyLow,
  SCANNER_EFFICIENCY_CHART_FILL_LOW,
  SCANNER_EFFICIENCY_CHART_FILL_NORMAL,
  SCANNER_TOTAL_EFFICIENCY_RED_LT,
} from './scannerEfficiencyThresholds'
import type { ScannerTotalEfficiencyRow } from './sortingLookup'

type Props = {
  rows: ScannerTotalEfficiencyRow[]
  className?: string
}

const FILL_NORMAL = SCANNER_EFFICIENCY_CHART_FILL_NORMAL
const FILL_LOW = SCANNER_EFFICIENCY_CHART_FILL_LOW

export default function ScannerTotalEfficiencyBarChart({ rows, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const chartRows = useMemo(
    () =>
      rows.filter(
        (row): row is ScannerTotalEfficiencyRow & { cainiaoAdjustedTotalEfficiency: number } =>
          row.cainiaoAdjustedTotalEfficiency != null && Number.isFinite(row.cainiaoAdjustedTotalEfficiency),
      ),
    [rows],
  )

  const rowsKey = useMemo(
    () => chartRows.map((r) => `${r.scanner}\t${r.cainiaoAdjustedTotalEfficiency}`).join('|'),
    [chartRows],
  )

  useEffect(() => {
    if (!chartRows.length) return
    const el = containerRef.current
    if (!el) return

    const data = chartRows.map((r) => ({
      ...r,
      cainiaoAdjustedTotalEfficiency: Number(r.cainiaoAdjustedTotalEfficiency.toFixed(2)),
    }))

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: Math.min(440, Math.max(260, 120 + chartRows.length * 20)),
      theme: 'light',
      paddingTop: 20,
      paddingRight: 24,
      paddingBottom: 28,
      paddingLeft: 92,
    })

    chart.scale('x', { type: 'band', paddingInner: 0.16 })
    chart.scale('y', {
      type: 'linear',
      nice: true,
      domainMin: 0,
    })

    chart.axis('y', {
      title: '总效率（票/小时，含菜鸟修正）',
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: '#e2e8f0',
    })

    chart.interaction('tooltip', true)

    chart
      .interval()
      .coordinate({ transform: [{ type: 'transpose' }] })
      .data(data)
      .encode('x', 'scanner')
      .encode('y', 'cainiaoAdjustedTotalEfficiency')
      .style('fill', (d: (typeof data)[number]) =>
        isScannerTotalEfficiencyLow(d.cainiaoAdjustedTotalEfficiency) ? FILL_LOW : FILL_NORMAL,
      )
      .style('fillOpacity', 0.88)

    void chart.render()

    return () => {
      chart.destroy()
    }
  }, [chartRows, rowsKey])

  if (!chartRows.length) {
    return (
      <div
        className={[
          'flex min-h-[220px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/80 text-sm text-slate-500',
          className ?? '',
        ].join(' ')}
      >
        暂无可匹配考勤的分拣员总效率数据。
      </div>
    )
  }

  return (
    <div className={className ?? ''}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-slate-600">
        <span className="font-medium text-slate-700">各分拣员总效率（票/小时）</span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-full" style={{ backgroundColor: FILL_NORMAL }} />
          ≥{SCANNER_TOTAL_EFFICIENCY_RED_LT}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-full" style={{ backgroundColor: FILL_LOW }} />
          &lt;{SCANNER_TOTAL_EFFICIENCY_RED_LT}
        </span>
      </div>
      <div
        ref={containerRef}
        className="g2-scanner-total-efficiency min-h-[220px] w-full"
        role="img"
        aria-label="分拣员总效率条形对比图"
      />
    </div>
  )
}
