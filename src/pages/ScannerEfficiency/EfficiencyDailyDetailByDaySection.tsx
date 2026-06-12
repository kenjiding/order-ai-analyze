import { useMemo } from 'react'
import DailyEfficiencyComboChart, {
  type DailyEfficiencyBubbleDatum,
  EFFICIENCY_CHART_OPEN_DAY_FILTER_TOOLTIP,
  type EfficiencyDetailDimension,
  isEfficiencyChartNonOpenDay,
} from './DailyEfficiencyBubbleChart'
import type { AttendanceDailyMatchRow } from './aggregates'
import { DataTable, SectionTitle } from './components/ui'
import type { DataTableColumn, DataTableRow } from './components/ui'

export type EfficiencyDailyDetailByDaySectionProps = {
  variant: 'full' | 'tableOnly'
  dimension: EfficiencyDetailDimension
  onDimensionChange: (next: EfficiencyDetailDimension) => void
  expandedWeekKeys: Set<string>
  onWeekRowClick: (row: DataTableRow) => void
  attendanceMatchColumns: DataTableColumn[]
  attendanceDailyAsTable: DataTableRow[]
  attendanceWeeklyAsTable: DataTableRow[]
  attendanceDayEfficiencyBubbleData: DailyEfficiencyBubbleDatum[]
  attendanceDailyRows: AttendanceDailyMatchRow[]
  chartOpenDaysOnly: boolean
  onChartOpenDaysOnlyChange: (next: boolean) => void
}

const DIMENSION_OPTIONS: { key: EfficiencyDetailDimension; label: string }[] = [
  { key: 'day', label: '日维度' },
  { key: 'week', label: '周维度' },
]

function DimensionToggle({
  value,
  onChange,
}: {
  value: EfficiencyDetailDimension
  onChange: (next: EfficiencyDetailDimension) => void
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
      role="tablist"
      aria-label="效率明细维度"
    >
      {DIMENSION_OPTIONS.map((option) => {
        const active = value === option.key
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={[
              'rounded-md px-3 py-1.5 text-xs font-semibold transition',
              active
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900',
            ].join(' ')}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function OpenDayChartToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
      title={EFFICIENCY_CHART_OPEN_DAY_FILTER_TOOLTIP}
    >
      <span>开仓</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={EFFICIENCY_CHART_OPEN_DAY_FILTER_TOOLTIP}
        className={[
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition',
          checked ? 'bg-blue-600' : 'bg-slate-300',
        ].join(' ')}
        onClick={() => onChange(!checked)}
      >
        <span
          className={[
            'inline-block h-4 w-4 rounded-full bg-white shadow transition',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

function EfficiencyDetailDataTable({
  dimension,
  expandedWeekKeys,
  onWeekRowClick,
  attendanceMatchColumns,
  tableRows,
}: {
  dimension: EfficiencyDetailDimension
  expandedWeekKeys: Set<string>
  onWeekRowClick: (row: DataTableRow) => void
  attendanceMatchColumns: DataTableColumn[]
  tableRows: DataTableRow[]
}) {
  return (
    <DataTable
      columns={attendanceMatchColumns}
      rows={tableRows}
      emptyText="暂无日期匹配数据。"
      isRowExpandable={(row) => Boolean(row.isWeekSummaryRow)}
      isRowExpanded={(row) => expandedWeekKeys.has(String(row.weekKey ?? ''))}
      getExpandedChildRows={(row) =>
        Array.isArray(row.weekDailyRows) ? (row.weekDailyRows as DataTableRow[]) : undefined
      }
      onRowClick={dimension === 'week' ? onWeekRowClick : undefined}
    />
  )
}

export function EfficiencyDailyDetailByDaySection({
  variant,
  dimension,
  onDimensionChange,
  expandedWeekKeys,
  onWeekRowClick,
  attendanceMatchColumns,
  attendanceDailyAsTable,
  attendanceWeeklyAsTable,
  attendanceDayEfficiencyBubbleData,
  attendanceDailyRows,
  chartOpenDaysOnly,
  onChartOpenDaysOnlyChange,
}: EfficiencyDailyDetailByDaySectionProps) {
  const tableRows = useMemo(
    () => (dimension === 'week' ? attendanceWeeklyAsTable : attendanceDailyAsTable),
    [dimension, attendanceWeeklyAsTable, attendanceDailyAsTable],
  )

  const chartBubbleData = useMemo(() => {
    if (!chartOpenDaysOnly) return attendanceDayEfficiencyBubbleData
    return attendanceDayEfficiencyBubbleData.filter((row) => !isEfficiencyChartNonOpenDay(row))
  }, [attendanceDayEfficiencyBubbleData, chartOpenDaysOnly])

  const useStackedLayout = dimension === 'week' || attendanceDailyRows.length > 7

  const description =
    dimension === 'week'
      ? '表格每行汇总一周关键指标，点击周行可展开查看逐日明细。组合图保留日曲线，背景色块区分各周。'
      : useStackedLayout
        ? '按日展示到件与考勤匹配明细；下方组合图含货量、工时与当天效率。'
        : '按日展示到件与考勤匹配明细；右侧组合图含货量、工时与当天效率。'

  const dimensionLabel = dimension === 'week' ? '周维度' : '日维度'

  if (variant === 'tableOnly') {
    return (
      <section className="space-y-4">
        <SectionTitle
          eyebrow="Attendance Matching"
          title={`效率明细/天（${dimensionLabel}）`}
          description=""
        />
        <div className="min-w-0 overflow-x-auto px-4">
          <EfficiencyDetailDataTable
            dimension={dimension}
            expandedWeekKeys={expandedWeekKeys}
            onWeekRowClick={onWeekRowClick}
            attendanceMatchColumns={attendanceMatchColumns}
            tableRows={tableRows}
          />
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          eyebrow="Attendance Matching"
          title="效率明细/天"
          description={description}
        />
        <div className="flex flex-wrap items-center gap-2">
          <OpenDayChartToggle checked={chartOpenDaysOnly} onChange={onChartOpenDaysOnlyChange} />
          <DimensionToggle value={dimension} onChange={onDimensionChange} />
        </div>
      </div>
      <div className={useStackedLayout ? 'grid gap-4' : 'grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start'}>
        <div className={`admin-panel min-w-0 overflow-hidden p-4 sm:p-5 ${useStackedLayout ? '' : 'xl:order-2'}`}>
          <DailyEfficiencyComboChart
            data={chartBubbleData}
            dimension={dimension}
            attendanceDailyRows={attendanceDailyRows}
          />
        </div>
        <div className={`min-w-0 overflow-x-auto px-4 ${useStackedLayout ? '' : 'xl:order-1'}`}>
          <EfficiencyDetailDataTable
            dimension={dimension}
            expandedWeekKeys={expandedWeekKeys}
            onWeekRowClick={onWeekRowClick}
            attendanceMatchColumns={attendanceMatchColumns}
            tableRows={tableRows}
          />
        </div>
      </div>
    </section>
  )
}
