import { useMemo } from 'react'
import DailyEfficiencyComboChart, {
  type DailyEfficiencyBubbleDatum,
  type EfficiencyDetailDimension,
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
}: EfficiencyDailyDetailByDaySectionProps) {
  const tableRows = useMemo(
    () => (dimension === 'week' ? attendanceWeeklyAsTable : attendanceDailyAsTable),
    [dimension, attendanceWeeklyAsTable, attendanceDailyAsTable],
  )

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
        <DimensionToggle value={dimension} onChange={onDimensionChange} />
      </div>
      <div className={useStackedLayout ? 'grid gap-4' : 'grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start'}>
        <div className={`admin-panel min-w-0 overflow-hidden p-4 sm:p-5 ${useStackedLayout ? '' : 'xl:order-2'}`}>
          <DailyEfficiencyComboChart
            data={attendanceDayEfficiencyBubbleData}
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
