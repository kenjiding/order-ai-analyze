import type { AttendanceEfficiencyResult, ScanAggregate, ScannerEfficiencyResult } from './aggregates'
import type { ScanSettings } from './constants'
import type { SourceInfo } from './exportWorkbook'
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

const METRIC_DEFINITIONS: MetricDefinition[] = [
  { key: 'totalVolume', label: '总货量', precision: 0, unit: '票', higherIsBetter: null },
  { key: 'averageDailyVolume', label: '日均货量', precision: 0, unit: '票/天', higherIsBetter: null },
  { key: 'peakDailyVolume', label: '峰值日货量', precision: 0, unit: '票', higherIsBetter: null },
  { key: 'totalLaborCost', label: '人工总成本', precision: 2, unit: '$', higherIsBetter: false },
  { key: 'averageCostPerTicket', label: '每票成本', precision: 2, unit: '$/票', higherIsBetter: false },
  { key: 'openDayCount', label: '开仓天数', precision: 0, unit: '天', higherIsBetter: null },
  { key: 'openEfficiency', label: '开仓效率', precision: 2, unit: '票/小时', higherIsBetter: true },
  { key: 'overallEfficiency', label: '总体效率', precision: 2, unit: '票/小时', higherIsBetter: true },
  { key: 'attendanceMatchRate', label: '考勤匹配率', precision: 1, unit: '%', higherIsBetter: true },
  { key: 'unmatchedDayCount', label: '未匹配天数', precision: 0, unit: '天', higherIsBetter: false },
  { key: 'sortingEfficiency', label: '小工效率', precision: 2, unit: '票/小时', higherIsBetter: true },
  { key: 'sortingScanCount', label: '一级分拣扫描量', precision: 0, unit: '票', higherIsBetter: null },
  { key: 'sortingEffectiveHours', label: '一级分拣有效工时', precision: 2, unit: '小时', higherIsBetter: null },
  { key: 'sortingScannerCount', label: '扫描员人数', precision: 0, unit: '人', higherIsBetter: null },
]

const metricDefinitionMap = new Map(METRIC_DEFINITIONS.map((definition) => [definition.key, definition]))

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
    return `${formatNumber(value, definition.precision)} 个百分点`
  }
  return formatMetricValue(definition, value)
}

export const formatWeeklyMetricValue = (key: WeeklyMetricKey, value: number): string => {
  const definition = metricDefinitionMap.get(key)
  return definition ? formatMetricValue(definition, value) : formatNumber(value, 2)
}

export const formatWeeklyMetricDeltaValue = (key: WeeklyMetricKey, value: number): string => {
  const definition = metricDefinitionMap.get(key)
  return definition ? formatMetricDeltaValue(definition, value) : formatNumber(value, 2)
}

export function buildWeeklyReportSnapshot({
  scanAggregate,
  attendanceResult,
  scannerResult,
  scanSourceInfo,
  attendanceSourceInfo,
  settings,
  dailyCostPerTicketByDate,
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
    return `与上周持平，均为 ${formatMetricValue(definition, currentValue)}。`
  }

  const directionText = delta > 0 ? '上升' : '下降'
  const deltaPercent = previousValue === 0 ? null : (Math.abs(delta) / Math.abs(previousValue)) * 100
  const percentText = deltaPercent == null ? '' : `，变化 ${formatNumber(deltaPercent, 1)}%`
  return `本周 ${formatMetricValue(definition, currentValue)}，较上周 ${formatMetricValue(
    definition,
    previousValue,
  )} ${directionText} ${formatMetricDeltaValue(definition, Math.abs(delta))}${percentText}。`
}

const assessMetric = (definition: MetricDefinition, deltaValue: number): WeeklyMetricComparison['assessment'] => {
  if (definition.higherIsBetter == null || Math.abs(deltaValue) < Number.EPSILON) return 'neutral'
  return deltaValue > 0 === definition.higherIsBetter ? 'positive' : 'negative'
}

export function buildWeeklySnapshotComparison(
  currentSnapshot: WeeklyReportSnapshot,
  previousSnapshot: WeeklyReportSnapshot,
): WeeklySnapshotComparison {
  const allRows = METRIC_DEFINITIONS.flatMap((definition) => {
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
      label: '数据完整性',
      value:
        attendanceMatchRate.deltaValue >= 0
          ? `+${formatNumber(attendanceMatchRate.deltaValue, 1)} 个百分点`
          : `${formatNumber(attendanceMatchRate.deltaValue, 1)} 个百分点`,
      text: attendanceMatchRate.text,
    })
  }

  if (totalVolume && totalVolume.deltaPercent != null && totalVolume.deltaPercent > 10 && openEfficiency?.assessment === 'negative') {
    actions.push('货量较上周明显上升但开仓效率下降，优先复盘高峰日排班、任务分配和临时增援是否同步到位。')
  }
  if (openEfficiency?.assessment === 'negative') {
    actions.push('开仓效率低于上周，建议对比低效日期的工时结构、分拣人数和货量峰值。')
  }
  if (overallEfficiency?.assessment === 'negative') {
    actions.push('总体效率低于上周，检查不开仓日工时、考勤补录和非生产性工时是否拉低分母。')
  }
  if (sortingEfficiency?.assessment === 'negative') {
    actions.push('小工效率低于上周，抽查扫描间隔、人员熟练度和任务拆分是否存在异常。')
  }
  if (averageCostPerTicket?.assessment === 'negative') {
    actions.push('每票成本高于上周，优先核对高成本日的低货量错配、异常工时与班次安排。')
  }
  if (attendanceMatchRate?.assessment === 'negative') {
    actions.push('考勤匹配率低于上周，先补齐缺失考勤再下结论，避免效率判断被数据缺口放大。')
  }

  if (!conclusions.length && allRows.length) conclusions.push(`已完成与上周（${previousSnapshot.periodStart} ~ ${previousSnapshot.periodEnd}）的同口径对比。`)
  if (!actions.length && allRows.some((row) => row.assessment === 'positive')) {
    actions.push('本周核心效率较上周改善，建议固化对应排班和作业节奏，下周继续观察是否稳定。')
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
