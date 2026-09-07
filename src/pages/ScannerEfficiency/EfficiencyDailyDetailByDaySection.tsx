import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'
import { i18n } from '../../i18n/index'
import DailyEfficiencyComboChart, {
  type DailyEfficiencyBubbleDatum,
  type EfficiencyDetailDimension,
  isEfficiencyChartNonOpenDay,
} from './DailyEfficiencyBubbleChart'
import {
  EFFICIENCY_CHART_NON_OPEN_MAX_SORTERS,
  EFFICIENCY_CHART_NON_OPEN_MAX_VOLUME,
} from './constants'
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

// dimension options built inside component

function DimensionToggle({
  value,
  onChange,
}: {
  value: EfficiencyDetailDimension
  onChange: (next: EfficiencyDetailDimension) => void
}) {
  const { t } = useTranslation('scannerEfficiency')
  const dimensionOptions = [
    { key: 'day' as const, label: t('dimension.day') },
    { key: 'week' as const, label: t('dimension.week') },
  ]
  return (
    <div className="se-segmented" role="tablist" aria-label={t('dimension.toggleAria')}>
      {dimensionOptions.map((option) => {
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
  tooltip,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  tooltip: string
}) {
  const { t } = useTranslation('scannerEfficiency')
  return (
    <div className="se-control-toggle" title={tooltip}>
      <span>{t('dimension.openDayToggle')}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={tooltip}
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
  emptyText,
}: {
  dimension: EfficiencyDetailDimension
  expandedWeekKeys: Set<string>
  onWeekRowClick: (row: DataTableRow) => void
  attendanceMatchColumns: DataTableColumn[]
  tableRows: DataTableRow[]
  emptyText: string
}) {
  return (
    <DataTable
      columns={attendanceMatchColumns}
      rows={tableRows}
      emptyText={emptyText}
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
  const { t } = useTranslation('scannerEfficiency')
  const openDayFilterTooltip = String(
    i18n.t('chart.openDayFilterTooltip', {
      ns: 'scannerEfficiency',
      maxSorters: EFFICIENCY_CHART_NON_OPEN_MAX_SORTERS,
      maxVolume: EFFICIENCY_CHART_NON_OPEN_MAX_VOLUME,
    }),
  )
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
      ? t('section.efficiencyDetailWeekDesc')
      : useStackedLayout
        ? t('section.efficiencyDetailStackedDesc')
        : t('section.efficiencyDetailSideDesc')

  const dimensionLabel = dimension === 'week' ? t('dimension.week') : t('dimension.day')

  if (variant === 'tableOnly') {
    return (
      <section className="space-y-4">
        <SectionTitle
          eyebrow="Attendance Matching"
          title={t('section.efficiencyDetailTitleWithDim', { dimension: dimensionLabel })}
          description=""
        />
        <div className="min-w-0 overflow-x-auto px-4">
          <EfficiencyDetailDataTable
            dimension={dimension}
            expandedWeekKeys={expandedWeekKeys}
            onWeekRowClick={onWeekRowClick}
            attendanceMatchColumns={attendanceMatchColumns}
            tableRows={tableRows}
            emptyText={t('empty.noDateMatch')}
          />
        </div>
      </section>
    )
  }

  return (
    <section className="admin-panel overflow-hidden">
      <SectionTitle
        title={t('section.efficiencyDetailTitle')}
        description={description}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <OpenDayChartToggle checked={chartOpenDaysOnly} onChange={onChartOpenDaysOnlyChange} tooltip={openDayFilterTooltip} />
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
            emptyText={t('empty.noDateMatch')}
          />
        </div>
      </div>
    </section>
  )
}
