import { i18n } from '../../i18n/index'
import type { AttendanceEfficiencyResult, ScanAggregate, ScannerEfficiencyResult } from './aggregates'
import type { ScanSettings } from './constants'
import type { SourceInfo } from './sourceInfo'
import { formatInteger, formatNumber } from './formatAndParse'

const DAY_MS = 24 * 60 * 60 * 1000

export type WeeklyMetricKey =
  | 'totalVolume'
  | 'averageDailyVolume'
  | 'peakDailyVolume'
  | 'totalLaborCost'
  | 'averageCostPerTicket'
  | 'openDayCount'
  | 'openEfficiency'
  | 'overallEfficiency'
  | 'attendanceMatchRate'
  | 'unmatchedDayCount'
  | 'sortingEfficiency'
  | 'sortingScanCount'
  | 'sortingEffectiveHours'
  | 'sortingScannerCount'

export type WeeklyReportMetrics = Record<WeeklyMetricKey, number | null>

export type WeeklyReportSnapshot = {
  id: string
  schemaVersion: 1
  periodStart: string
  periodEnd: string
  generatedAt: string
  expiresAt: string
  metrics: WeeklyReportMetrics
  source: {
    scanFileCount: number
    scanRowCount: number
    scanDroppedRows: number
    /** 历史快照可能无此字段（旧版保存） */
    scanDuplicateWaybillRows?: number
    scanFileNames: string[]
    attendanceFileCount: number
    attendanceRowCount: number
    attendanceDroppedRows: number
    attendanceFileNames: string[]
  }
  settings: Pick<ScanSettings, 'openDayThreshold' | 'breakCapMinutes' | 'splitThresholdMinutes' | 'minSingleScanSessionMinutes'>
}

export type WeeklyMetricComparison = {
  key: WeeklyMetricKey
  label: string
  currentValue: number
  previousValue: number
  deltaValue: number
  deltaPercent: number | null
  direction: 'up' | 'down' | 'flat'
  assessment: 'positive' | 'negative' | 'neutral'
  text: string
}

export type WeeklySnapshotComparison = {
  previousPeriodText: string
  rows: WeeklyMetricComparison[]
  conclusions: string[]
  diagnostics: { label: string; value: string; text: string }[]
  actions: string[]
}

type MetricDefinition = {
  key: WeeklyMetricKey
  label: string
  precision: number
  unit: string
  higherIsBetter: boolean | null
}

function getMetricDefinitions(): MetricDefinition[] {
  const t = (key: string) => String(i18n.t(key, { ns: 'scannerEfficiency' }))
  return [
  { key: 'totalVolume', label: t('weekly.metric.totalVolume'), precision: 0, unit: t('weekly.metric.unitTickets'), higherIsBetter: null },
  { key: 'averageDailyVolume', label: t('weekly.metric.averageDailyVolume'), precision: 0, unit: t('weekly.metric.unitTicketsPerDay'), higherIsBetter: null },
  { key: 'peakDailyVolume', label: t('weekly.metric.peakDailyVolume'), precision: 0, unit: t('weekly.metric.unitTickets'), higherIsBetter: null },
  { key: 'totalLaborCost', label: t('weekly.metric.totalLaborCost'), precision: 2, unit: '$', higherIsBetter: false },
  { key: 'averageCostPerTicket', label: t('weekly.metric.averageCostPerTicket'), precision: 2, unit: t('weekly.metric.unitCostPerTicket'), higherIsBetter: false },
  { key: 'openDayCount', label: t('weekly.metric.openDayCount'), precision: 0, unit: t('weekly.metric.unitDays'), higherIsBetter: null },
  { key: 'openEfficiency', label: t('weekly.metric.openEfficiency'), precision: 2, unit: t('weekly.metric.unitTicketsPerHour'), higherIsBetter: true },
  { key: 'overallEfficiency', label: t('weekly.metric.overallEfficiency'), precision: 2, unit: t('weekly.metric.unitTicketsPerHour'), higherIsBetter: true },
  { key: 'attendanceMatchRate', label: t('weekly.metric.attendanceMatchRate'), precision: 1, unit: '%', higherIsBetter: true },
  { key: 'unmatchedDayCount', label: t('weekly.metric.unmatchedDayCount'), precision: 0, unit: t('weekly.metric.unitDays'), higherIsBetter: false },
  { key: 'sortingEfficiency', label: t('weekly.metric.sortingEfficiency'), precision: 2, unit: t('weekly.metric.unitTicketsPerHour'), higherIsBetter: true },
  { key: 'sortingScanCount', label: t('weekly.metric.sortingScanCount'), precision: 0, unit: t('weekly.metric.unitTickets'), higherIsBetter: null },
  { key: 'sortingEffectiveHours', label: t('weekly.metric.sortingEffectiveHours'), precision: 2, unit: t('weekly.metric.unitHours'), higherIsBetter: null },
  { key: 'sortingScannerCount', label: t('weekly.metric.sortingScannerCount'), precision: 0, unit: t('weekly.metric.unitPeople'), higherIsBetter: null },
  ]
}

function metricDefinitionFor(key: WeeklyMetricKey): MetricDefinition | undefined {
  return getMetricDefinitions().find((definition) => definition.key === key)
}

/** 环比上周表格中不展示的指标（仍参与快照与结论推导） */
const WEEK_OVER_WEEK_TABLE_EXCLUDED_KEYS = new Set<WeeklyMetricKey>([
  'attendanceMatchRate',
  'unmatchedDayCount',
  'sortingScanCount',
  'sortingEffectiveHours',
])

const formatDateKeyFromDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export const addDaysToDateKey = (dateKey: string, days: number): string => {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + days)
  return formatDateKeyFromDate(date)
}

const addDaysToIso = (date: Date, days: number): string => new Date(date.getTime() + days * DAY_MS).toISOString()

const finiteOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const formatMetricValue = (definition: MetricDefinition, value: number): string => {
  const formatted = definition.precision === 0 ? formatInteger(value) : formatNumber(value, definition.precision)
  return `${formatted}${definition.unit ? ` ${definition.unit}` : ''}`
}

const formatMetricDeltaValue = (definition: MetricDefinition, value: number): string => {
  if (definition.unit === '%') {
    return `${formatNumber(value, definition.precision)} ${String(i18n.t('weekly.metric.unitPercentPoints', { ns: 'scannerEfficiency' }))}`
  }
  return formatMetricValue(definition, value)
}

export const formatWeeklyMetricValue = (key: WeeklyMetricKey, value: number): string => {
  const definition = metricDefinitionFor(key)
  return definition ? formatMetricValue(definition, value) : formatNumber(value, 2)
}

export const formatWeeklyMetricDeltaValue = (key: WeeklyMetricKey, value: number): string => {
  const definition = metricDefinitionFor(key)
  return definition ? formatMetricDeltaValue(definition, value) : formatNumber(value, 2)
}

export function buildWeeklyReportSnapshot({
  scanAggregate,
  attendanceResult,
  scannerResult,
  scanSourceInfo,
  attendanceSourceInfo,
  settings,
  dailyCostPerTicketByDate: _dailyCostPerTicketByDate,
  dailyTotalLaborCostByDate,
  generatedAt = new Date(),
}: {
  scanAggregate: ScanAggregate
  attendanceResult: AttendanceEfficiencyResult | null
  scannerResult: ScannerEfficiencyResult | null
  scanSourceInfo: SourceInfo
  attendanceSourceInfo: SourceInfo
  settings: ScanSettings
  dailyCostPerTicketByDate?: Record<string, number | null>
  dailyTotalLaborCostByDate?: Record<string, number | null>
  generatedAt?: Date
}): WeeklyReportSnapshot {
  const scanPeriodStart = scanAggregate.dailyRows[0].date
  const scanPeriodEnd = scanAggregate.dailyRows[scanAggregate.dailyRows.length - 1].date
  const periodStart = attendanceResult?.summary.attendanceSheetRangeStart ?? scanPeriodStart
  const periodEnd = attendanceResult?.summary.attendanceSheetRangeEnd ?? scanPeriodEnd
  const totalVolume = scanAggregate.summary.totalVolume
  const averageDailyVolume = scanAggregate.dailyRows.length ? totalVolume / scanAggregate.dailyRows.length : null
  const peakDailyVolume = scanAggregate.dailyRows.reduce((max, row) => Math.max(max, row.volume), 0)
  const matchedScanDayCount =
    attendanceResult?.dailyRows.filter((row) => row.hasAttendance && !row.isAttendanceOnly).length ?? null
  const attendanceMatchRate =
    matchedScanDayCount == null || !scanAggregate.dailyRows.length
      ? null
      : (matchedScanDayCount / scanAggregate.dailyRows.length) * 100
  const laborRows = (attendanceResult?.dailyRows ?? []).filter((row) => {
    if (!row.hasAttendance) return false
    const labor = dailyTotalLaborCostByDate?.[row.date]
    return labor != null && Number.isFinite(labor) && labor >= 0
  })
  const totalLaborCost = laborRows.length
    ? laborRows.reduce((sum, row) => sum + (dailyTotalLaborCostByDate![row.date] as number), 0)
    : null
  const totalVolumeForCost = (attendanceResult?.dailyRows ?? []).reduce(
    (sum, row) => sum + (row.hasAttendance && row.volume > 0 ? row.volume : 0),
    0,
  )
  const averageCostPerTicket =
    totalLaborCost != null && totalVolumeForCost > 0 ? totalLaborCost / totalVolumeForCost : null

  return {
    id: `${periodStart}_${periodEnd}_${generatedAt.toISOString()}`,
    schemaVersion: 1,
    periodStart,
    periodEnd,
    generatedAt: generatedAt.toISOString(),
    expiresAt: addDaysToIso(generatedAt, 31),
    metrics: {
      totalVolume,
      averageDailyVolume,
      peakDailyVolume,
      totalLaborCost: finiteOrNull(totalLaborCost),
      averageCostPerTicket: finiteOrNull(averageCostPerTicket),
      openDayCount: attendanceResult?.summary.openDayCount ?? null,
      openEfficiency: finiteOrNull(attendanceResult?.summary.openEfficiency),
      overallEfficiency: finiteOrNull(attendanceResult?.summary.overallEfficiency),
      attendanceMatchRate: finiteOrNull(attendanceMatchRate),
      unmatchedDayCount: attendanceResult?.summary.unmatchedDayCount ?? null,
      sortingEfficiency: finiteOrNull(scannerResult?.summary.totalEfficiency),
      sortingScanCount: scannerResult?.summary.totalScanCount ?? null,
      sortingEffectiveHours: finiteOrNull(scannerResult?.summary.totalEffectiveHours),
      sortingScannerCount: scannerResult?.summary.totalScanners ?? null,
    },
    source: {
      scanFileCount: scanSourceInfo.fileCount,
      scanRowCount: scanSourceInfo.rowCount,
      scanDroppedRows: scanSourceInfo.droppedRows,
      scanDuplicateWaybillRows: scanSourceInfo.duplicateWaybillRows,
      scanFileNames: scanSourceInfo.fileNames,
      attendanceFileCount: attendanceSourceInfo.fileCount,
      attendanceRowCount: attendanceSourceInfo.rowCount,
      attendanceDroppedRows: attendanceSourceInfo.droppedRows,
      attendanceFileNames: attendanceSourceInfo.fileNames,
    },
    settings: {
      openDayThreshold: settings.openDayThreshold,
      breakCapMinutes: settings.breakCapMinutes,
      splitThresholdMinutes: settings.splitThresholdMinutes,
      minSingleScanSessionMinutes: settings.minSingleScanSessionMinutes,
    },
  }
}

const buildComparisonText = (definition: MetricDefinition, currentValue: number, previousValue: number): string => {
  const delta = currentValue - previousValue
  if (Math.abs(delta) < Number.EPSILON) {
    return String(i18n.t('weekly.comparisonFlat', { ns: 'scannerEfficiency', value: formatMetricValue(definition, currentValue) }))
  }

  const directionText = delta > 0 ? String(i18n.t('weekly.directionUp', { ns: 'scannerEfficiency' })) : String(i18n.t('weekly.directionDown', { ns: 'scannerEfficiency' }))
  const deltaPercent = previousValue === 0 ? null : (Math.abs(delta) / Math.abs(previousValue)) * 100
  const percentText = deltaPercent == null ? '' : String(i18n.t('weekly.changePercent', { ns: 'scannerEfficiency', percent: formatNumber(deltaPercent, 1) }))
  return String(i18n.t('weekly.comparisonChanged', { ns: 'scannerEfficiency', current: formatMetricValue(definition, currentValue), previous: formatMetricValue(definition, previousValue), direction: directionText, delta: formatMetricDeltaValue(definition, Math.abs(delta)), percent: percentText }))
}

const assessMetric = (definition: MetricDefinition, deltaValue: number): WeeklyMetricComparison['assessment'] => {
  if (definition.higherIsBetter == null || Math.abs(deltaValue) < Number.EPSILON) return 'neutral'
  return deltaValue > 0 === definition.higherIsBetter ? 'positive' : 'negative'
}

export function buildWeeklySnapshotComparison(
  currentSnapshot: WeeklyReportSnapshot,
  previousSnapshot: WeeklyReportSnapshot,
): WeeklySnapshotComparison {
  const allRows = getMetricDefinitions().flatMap((definition) => {
    const currentValue = currentSnapshot.metrics[definition.key]
    const previousValue = previousSnapshot.metrics[definition.key]
    if (currentValue == null || previousValue == null) return []

    const deltaValue = currentValue - previousValue
    const deltaPercent = previousValue === 0 ? null : (deltaValue / Math.abs(previousValue)) * 100
    const direction: WeeklyMetricComparison['direction'] =
      Math.abs(deltaValue) < Number.EPSILON ? 'flat' : deltaValue > 0 ? 'up' : 'down'
    return [
      {
        key: definition.key,
        label: definition.label,
        currentValue,
        previousValue,
        deltaValue,
        deltaPercent,
        direction,
        assessment: assessMetric(definition, deltaValue),
        text: buildComparisonText(definition, currentValue, previousValue),
      },
    ]
  })

  const rows = allRows.filter((row) => !WEEK_OVER_WEEK_TABLE_EXCLUDED_KEYS.has(row.key))

  const conclusions: string[] = []
  const diagnostics: { label: string; value: string; text: string }[] = []
  const actions: string[] = []
  const byKey = new Map(allRows.map((row) => [row.key, row]))

  const totalVolume = byKey.get('totalVolume')
  if (totalVolume) conclusions.push(totalVolume.text)

  const openEfficiency = byKey.get('openEfficiency')
  const overallEfficiency = byKey.get('overallEfficiency')
  const sortingEfficiency = byKey.get('sortingEfficiency')
  const averageCostPerTicket = byKey.get('averageCostPerTicket')
  ;[openEfficiency, overallEfficiency, sortingEfficiency, averageCostPerTicket].filter(Boolean).forEach((row) => {
    if (!row) return
    diagnostics.push({
      label: row.label,
      value:
        row.deltaPercent == null
          ? formatWeeklyMetricValue(row.key, row.deltaValue)
          : `${row.deltaPercent >= 0 ? '+' : ''}${formatNumber(row.deltaPercent, 1)}%`,
      text: row.text,
    })
  })

  const attendanceMatchRate = byKey.get('attendanceMatchRate')
  if (attendanceMatchRate) {
    diagnostics.push({
      label: String(i18n.t('weekly.dataIntegrity', { ns: 'scannerEfficiency' })),
      value:
        attendanceMatchRate.deltaValue >= 0
          ? `+${formatNumber(attendanceMatchRate.deltaValue, 1)} ${String(i18n.t('weekly.units.unitPercentPoints', { ns: 'scannerEfficiency' }))}`
          : `${formatNumber(attendanceMatchRate.deltaValue, 1)} ${String(i18n.t('weekly.units.unitPercentPoints', { ns: 'scannerEfficiency' }))}`,
      text: attendanceMatchRate.text,
    })
  }

  if (totalVolume && totalVolume.deltaPercent != null && totalVolume.deltaPercent > 10 && openEfficiency?.assessment === 'negative') {
    actions.push(String(i18n.t('weekly.actionVolumeUpEffDown', { ns: 'scannerEfficiency' })))
  }
  if (openEfficiency?.assessment === 'negative') {
    actions.push(String(i18n.t('weekly.actionOpenEffDown', { ns: 'scannerEfficiency' })))
  }
  if (overallEfficiency?.assessment === 'negative') {
    actions.push(String(i18n.t('weekly.actionOverallEffDown', { ns: 'scannerEfficiency' })))
  }
  if (sortingEfficiency?.assessment === 'negative') {
    actions.push(String(i18n.t('weekly.actionSortingEffDown', { ns: 'scannerEfficiency' })))
  }
  if (averageCostPerTicket?.assessment === 'negative') {
    actions.push(String(i18n.t('weekly.actionCostUp', { ns: 'scannerEfficiency' })))
  }
  if (attendanceMatchRate?.assessment === 'negative') {
    actions.push(String(i18n.t('weekly.actionMatchRateDown', { ns: 'scannerEfficiency' })))
  }

  if (!conclusions.length && allRows.length) conclusions.push(String(i18n.t('weekly.comparisonDone', { ns: 'scannerEfficiency', start: previousSnapshot.periodStart, end: previousSnapshot.periodEnd })))
  if (!actions.length && allRows.some((row) => row.assessment === 'positive')) {
    actions.push(String(i18n.t('weekly.actionImproved', { ns: 'scannerEfficiency' })))
  }

  return {
    previousPeriodText:
      previousSnapshot.periodStart === previousSnapshot.periodEnd
        ? previousSnapshot.periodStart
        : `${previousSnapshot.periodStart} ~ ${previousSnapshot.periodEnd}`,
    rows,
    conclusions,
    diagnostics,
    actions,
  }
}

export function getPreviousWeeklyPeriod(periodStart: string, periodEnd: string): { periodStart: string; periodEnd: string } {
  return {
    periodStart: addDaysToDateKey(periodStart, -7),
    periodEnd: addDaysToDateKey(periodEnd, -7),
  }
}
