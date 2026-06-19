import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import {
  isScannerAdjustedEfficiencyLow,
  SCANNER_ADJUSTED_EFFICIENCY_RED_LT,
  SCANNER_EFFICIENCY_CHART_FILL_LOW,
  SCANNER_EFFICIENCY_CHART_FILL_NORMAL,
} from './scannerEfficiencyThresholds'

export type ScannerSummaryChartRow = {
  scanner: string
  scanCount: number
  cainiaoScanCount: number
  cainiaoShare: number
  cainiaoCorrectionFactor: number
  activeDays: number
  effectiveHours: number
  efficiency: number
  reliabilityWeight: number
  adjustedEfficiency: number
  cainiaoAdjustedEfficiency: number
}

type Props = {
  rows: ScannerSummaryChartRow[]
  className?: string
}

const FILL_NORMAL = SCANNER_EFFICIENCY_CHART_FILL_NORMAL
const FILL_LOW = SCANNER_EFFICIENCY_CHART_FILL_LOW

export default function ScannerSummaryBarChart({ rows, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const rowsKey = useMemo(
    () => rows.map((r) => `${r.scanner}\t${r.cainiaoAdjustedEfficiency}`).join('|'),
    [rows],
  )

  useEffect(() => {
    if (!rows.length) return
    const el = containerRef.current
    if (!el) return

    const data = rows.map((r) => ({
      ...r,
      cainiaoAdjustedEfficiency: Number.isFinite(r.cainiaoAdjustedEfficiency) ? r.cainiaoAdjustedEfficiency : 0,
    }))

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: Math.min(440, Math.max(260, 120 + rows.length * 20)),
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
      title: '修正效率（票/小时，含菜鸟修正）',
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
      .encode('y', 'cainiaoAdjustedEfficiency')
      .style('fill', (d: (typeof data)[number]) =>
        isScannerAdjustedEfficiencyLow(d.cainiaoAdjustedEfficiency) ? FILL_LOW : FILL_NORMAL,
      )
      .style('fillOpacity', 0.88)

    void chart.render()

    return () => {
      chart.destroy()
    }
  }, [rows, rowsKey])

  if (!rows.length) {
    return (
      <div
        className={[
          'flex min-h-[220px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/80 text-sm text-slate-500',
          className ?? '',
        ].join(' ')}
      >
        暂无扫描员汇总数据。
      </div>
    )
  }

  return (
    <div className={className ?? ''}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-slate-600">
        <span className="font-medium text-slate-700">各扫描员修正效率（票/小时）</span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-full" style={{ backgroundColor: FILL_NORMAL }} />
          ≥{SCANNER_ADJUSTED_EFFICIENCY_RED_LT}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-full" style={{ backgroundColor: FILL_LOW }} />
          &lt;{SCANNER_ADJUSTED_EFFICIENCY_RED_LT}
        </span>
      </div>
      <div
        ref={containerRef}
        className="g2-scanner-summary min-h-[220px] w-full"
        role="img"
        aria-label="扫描员修正效率条形对比图"
      />
    </div>
  )
}
