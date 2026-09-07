import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { buildDailyMetrics, buildEmployeeWageTotals, type WageRecordLike } from '../wageChartData'
import { WageDailyMetricLineChart } from './WageDailyMetricLineChart'
import { WageEmployeeTotalBarChart } from './WageEmployeeTotalBarChart'

type Props = {
  filteredWageRecords: WageRecordLike[]
  className?: string
}

export function WageChartsSection({ filteredWageRecords, className }: Props) {
  const { t } = useTranslation('wageSalary')

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
      <h4 className="mb-2 text-base font-semibold text-slate-800">{t('charts.sectionTitle')}</h4>
      <p className="mb-4 text-xs text-slate-600">{t('charts.sectionDesc')}</p>

      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 md:gap-5">
        <div className="min-w-0 rounded-md border border-slate-100 bg-white/90 p-4 shadow-sm">
          <WageEmployeeTotalBarChart rows={employeeRows} />
        </div>
        <div className="min-w-0 rounded-md border border-slate-100 bg-white/90 p-4 shadow-sm">
          <WageDailyMetricLineChart
            points={hoursPoints}
            yTitle={t('charts.dailyHoursYTitle')}
            legendLabel={t('charts.dailyHoursLegend')}
            stroke="#7c3aed"
            ariaLabel={t('charts.dailyHoursAria')}
          />
        </div>
      </div>
    </div>
  )
}
