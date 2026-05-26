import { useMemo } from 'react'
import { buildDailyMetrics, buildEmployeeWageTotals, type WageRecordLike } from '../wageChartData'
import { WageDailyMetricLineChart } from './WageDailyMetricLineChart'
import { WageEmployeeTotalBarChart } from './WageEmployeeTotalBarChart'

type Props = {
  filteredWageRecords: WageRecordLike[]
  className?: string
}

export function WageChartsSection({ filteredWageRecords, className }: Props) {
  const employeeRows = useMemo(
    () => buildEmployeeWageTotals(filteredWageRecords, 30),
    [filteredWageRecords],
  )

  const daily = useMemo(() => buildDailyMetrics(filteredWageRecords), [filteredWageRecords])

  const hoursPoints = useMemo(
    () => daily.map((d) => ({ date: d.date, value: d.totalHours })),
    [daily],
  )

  if (filteredWageRecords.length === 0) {
    return null
  }

  return (
    <div
      className={[
        'rounded-lg border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white p-5 shadow-sm',
        className ?? '',
      ].join(' ')}
    >
      <h4 className="mb-2 text-base font-semibold text-slate-800">数据可视化（当前筛选）</h4>
      <p className="mb-4 text-xs text-slate-600">与上方筛选条件一致。</p>

      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 md:gap-5">
        <div className="min-w-0 rounded-md border border-slate-100 bg-white/90 p-4 shadow-sm">
          <WageEmployeeTotalBarChart rows={employeeRows} />
        </div>
        <div className="min-w-0 rounded-md border border-slate-100 bg-white/90 p-4 shadow-sm">
          <WageDailyMetricLineChart
            points={hoursPoints}
            yTitle="工时（h）"
            legendLabel="按日出勤工时合计"
            stroke="#7c3aed"
            ariaLabel="按日工时合计折线图"
          />
        </div>
      </div>
    </div>
  )
}
