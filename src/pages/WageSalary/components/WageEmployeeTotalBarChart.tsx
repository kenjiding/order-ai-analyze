import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { EmployeeWageRow } from '../wageChartData'

type Props = {
  rows: EmployeeWageRow[]
  className?: string
}

const FILL = '#0d9488'

export function WageEmployeeTotalBarChart({ rows, className }: Props) {
  const { t } = useTranslation('wageSalary')
  const containerRef = useRef<HTMLDivElement>(null)
  const rowsKey = useMemo(
    () => rows.map((r) => `${r.label}\t${r.totalWage}\t${r.totalHours}`).join('|'),
    [rows],
  )
  const yTitle = t('charts.employeeBarYTitle')

  useEffect(() => {
    if (!rows.length) return
    const el = containerRef.current
    if (!el) return

    const data = rows.map((r, i) => ({
      rankLabel: `${i + 1}. ${r.label}`,
      totalWage: Number.isFinite(r.totalWage) ? r.totalWage : 0,
      totalHours: Number.isFinite(r.totalHours) ? r.totalHours : 0,
    }))

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: Math.min(520, Math.max(260, 120 + data.length * 20)),
      theme: 'light',
      paddingTop: 20,
      paddingRight: 24,
      paddingBottom: 28,
      paddingLeft: 100,
    })

    chart.scale('x', { type: 'band', paddingInner: 0.16 })
    chart.scale('y', {
      type: 'linear',
      nice: true,
      domainMin: 0,
    })

    chart.axis('y', {
      title: yTitle,
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: '#e2e8f0',
    })

    chart.interaction('tooltip', true)

    chart
      .interval()
      .coordinate({ transform: [{ type: 'transpose' }] })
      .data(data)
      .encode('x', 'rankLabel')
      .encode('y', 'totalWage')
      .style('fill', FILL)
      .style('fillOpacity', 0.9)

    const render = () => {
      void chart.render()
    }
    if (el.getBoundingClientRect().width < 8) {
      requestAnimationFrame(render)
    } else {
      render()
    }

    return () => {
      chart.destroy()
    }
  }, [rows, rowsKey, yTitle])

  if (!rows.length) {
    return (
      <div
        className={[
          'flex min-h-[200px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/80 text-sm text-slate-500',
          className ?? '',
        ].join(' ')}
      >
        {t('charts.noEmployeeData')}
      </div>
    )
  }

  return (
    <div className={className ?? ''}>
      <div className="mb-2 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-full" style={{ backgroundColor: FILL }} />
          {t('charts.employeeBarLegend')}
        </span>
      </div>
      <div
        ref={containerRef}
        className="g2-wage-employee-totals min-h-[220px] w-full"
        role="img"
        aria-label={t('charts.employeeBarAria')}
      />
    </div>
  )
}
