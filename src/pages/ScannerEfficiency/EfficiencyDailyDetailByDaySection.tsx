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
    <div className="se-segmented" role="tablist" aria-label="效率明细维度">
      {DIMENSION_OPTIONS.map((option) => {
        const active = value === option.key
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={['se-segmented-btn', active ? 'se-segmented-btn--active' : ''].join(' ')}
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
    <div className="se-control-toggle" title={EFFICIENCY_CHART_OPEN_DAY_FILTER_TOOLTIP}>
      <span>开仓</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={EFFICIENCY_CHART_OPEN_DAY_FILTER_TOOLTIP}
        className={['se-switch', checked ? 'se-switch--on' : ''].join(' ')}
        onClick={() => onChange(!checked)}
      >
        <span className="se-switch-knob" />
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
        ? '按日展示到件与考勤匹配明细；下方组合图含货量、分拣人数与当天效率。'
        : '按日展示到件与考勤匹配明细；右侧组合图含货量、分拣人数与当天效率。'

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
    <section className="admin-panel overflow-hidden">
      <SectionTitle
        title="效率明细/天"
        description={description}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <OpenDayChartToggle checked={chartOpenDaysOnly} onChange={onChartOpenDaysOnlyChange} />
            <DimensionToggle value={dimension} onChange={onDimensionChange} />
          </div>
        }
      />
      <div
        className={[
          'p-4 pt-0',
          useStackedLayout
            ? 'grid gap-4'
            : 'grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start',
        ].join(' ')}
      >
        <div className={`admin-panel min-w-0 overflow-hidden p-4 sm:p-5 ${useStackedLayout ? '' : 'xl:order-2'}`}>
          <DailyEfficiencyComboChart
            data={chartBubbleData}
            dimension={dimension}
            attendanceDailyRows={attendanceDailyRows}
          />
        </div>
        <div className={`min-w-0 overflow-x-auto ${useStackedLayout ? '' : 'xl:order-1'}`}>
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
