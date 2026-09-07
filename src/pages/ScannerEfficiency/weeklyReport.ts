import { i18n } from '../../i18n/index'
import { TAB_KEYS } from './constants'
import {
  computeAttendanceDailyMatchAverages,
  type ScanAggregate,
  type AttendanceEfficiencyResult,
  type ScannerEfficiencyResult,
} from './aggregates'
import { formatInteger, formatNumber } from './formatAndParse'
import type { SourceInfo } from './sourceInfo'
import {
  buildWeeklySnapshotComparison,
  formatWeeklyMetricDeltaValue,
  formatWeeklyMetricValue,
  type WeeklyMetricComparison,
  type WeeklyReportSnapshot,
} from './weeklyReportSnapshot'
import type { WeeklyAiAnalysis } from './openaiWeeklyReport'

const wt = (key: string, options?: Record<string, unknown>) =>
  String(i18n.t(key, { ns: 'scannerEfficiency', ...options }))

const listSep = () => String(i18n.t('common.listSeparator', { ns: 'scannerEfficiency' })).trim() || '、'

export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const resolveReportMode = ({
  reportMode,
  attendanceResult,
  scannerResult,
}: {
  reportMode: string
  attendanceResult: AttendanceEfficiencyResult | null
  scannerResult: ScannerEfficiencyResult | null
}): string => {
  if (reportMode === TAB_KEYS.WAREHOUSE) {
    return attendanceResult ? TAB_KEYS.WAREHOUSE : 'volume'
  }
  if (reportMode === TAB_KEYS.SCANNER) {
    return scannerResult ? TAB_KEYS.SCANNER : 'volume'
  }
  if (attendanceResult) return TAB_KEYS.WAREHOUSE
  if (scannerResult) return TAB_KEYS.SCANNER
  return 'volume'
}

export const buildWeeklySummaryText = ({
  scanAggregate,
  attendanceResult,
  scannerResult,
  reportMode,
  attendanceDailyCostPerTicket,
  attendanceDailyTotalLaborCost,
}: {
  scanAggregate: ScanAggregate
  attendanceResult: AttendanceEfficiencyResult | null
  scannerResult: ScannerEfficiencyResult | null
  reportMode: string
  attendanceDailyCostPerTicket?: Record<string, number | null>
  attendanceDailyTotalLaborCost?: Record<string, number | null>
}): string => {
  const effectiveMode = resolveReportMode({ reportMode, attendanceResult, scannerResult })

  if (effectiveMode === TAB_KEYS.WAREHOUSE && attendanceResult) {
    const { summary } = attendanceResult
    const weeklyCostSummary = summarizeWeeklyCost({
      attendanceResult,
      attendanceDailyCostPerTicket,
      attendanceDailyTotalLaborCost,
    })
    const unmatchedText = summary.unmatchedDayCount
      ? wt('weekly.analysis.unmatchedDays', {
          count: summary.unmatchedDayCount,
          dates: summary.unmatchedDates.join(listSep()),
        })
      : wt('weekly.analysis.allMatched')
    return [
      wt('weekly.analysis.warehouseModeSummary', {
        uploaded: formatInteger(summary.uploadedVolume),
        matched: formatInteger(summary.matchedVolume),
      }),
      wt('weekly.analysis.warehouseOpenEff', {
        eff: formatNumber(summary.openEfficiency, 2),
        hours: formatNumber(summary.openHours, 2),
      }),
      wt('weekly.analysis.warehouseOverallEff', {
        eff: formatNumber(summary.overallEfficiency, 2),
        hours: formatNumber(summary.allHours, 2),
        start: summary.efficiencyRangeStart,
        end: summary.efficiencyRangeEnd,
      }),
      weeklyCostSummary
        ? wt('weekly.analysis.warehouseCost', {
            cost: formatNumber(weeklyCostSummary.totalLaborCost, 2),
            unit: formatNumber(weeklyCostSummary.averageCostPerTicket, 2),
          })
        : '',
      wt('weekly.analysis.warehouseOpenDays', {
        days: formatInteger(summary.openDayCount),
        unmatched: unmatchedText,
      }),
    ].join(' ')
  }

  if (effectiveMode === TAB_KEYS.SCANNER && scannerResult) {
    const { summary } = scannerResult
    return wt('weekly.analysis.sortingModeSummary', {
      eff: formatNumber(summary.totalEfficiency, 2),
      days: summary.totalDays,
      scanners: summary.totalScanners,
    })
  }

  return wt('weekly.analysis.volumeOnlySummary', {
    volume: formatInteger(scanAggregate.summary.totalVolume),
    days: scanAggregate.summary.totalDays,
  })
}

export const resolveWeeklyReportPeriod = (
  scanAggregate: ScanAggregate | null,
  attendanceResult: AttendanceEfficiencyResult | null,
): { startDate: string; endDate: string } | null => {
  if (!scanAggregate?.dailyRows.length) return null
  if (attendanceResult) {
    const { attendanceSheetRangeStart, attendanceSheetRangeEnd } = attendanceResult.summary
    return { startDate: attendanceSheetRangeStart, endDate: attendanceSheetRangeEnd }
  }
  return {
    startDate: scanAggregate.dailyRows[0].date,
    endDate: scanAggregate.dailyRows[scanAggregate.dailyRows.length - 1].date,
  }
}

export const formatWeeklyReportPeriodText = (startDate: string, endDate: string): string =>
  startDate === endDate ? startDate : `${startDate} ~ ${endDate}`

export const buildWeeklyReportTitle = (
  scanAggregate: ScanAggregate | null,
  attendanceResult: AttendanceEfficiencyResult | null = null,
): string => {
  const period = resolveWeeklyReportPeriod(scanAggregate, attendanceResult)
  if (!period) return String(i18n.t('weekly.defaultTitle', { ns: 'scannerEfficiency' }))
  return String(i18n.t('weekly.titleWithPeriod', { ns: 'scannerEfficiency', period: formatWeeklyReportPeriodText(period.startDate, period.endDate) }))
}

export const getExtremeRow = <T>(
  rows: T[],
  valueGetter: (row: T) => number,
  direction: 'max' | 'min' = 'max',
): T | null => {
  const validRows = rows.filter((row) => Number.isFinite(valueGetter(row)))
  if (!validRows.length) return null
  return validRows.reduce((selected, row) => {
    const currentValue = valueGetter(row)
    const selectedValue = valueGetter(selected)
    return direction === 'min'
      ? currentValue < selectedValue
        ? row
        : selected
      : currentValue > selectedValue
        ? row
        : selected
  })
}

type WeeklyCostSummary = {
  totalLaborCost: number
  averageCostPerTicket: number
  sampleDays: number
  highestDay: { date: string; costPerTicket: number } | null
  lowestDay: { date: string; costPerTicket: number } | null
}

function summarizeWeeklyCost({
  attendanceResult,
  attendanceDailyCostPerTicket,
  attendanceDailyTotalLaborCost,
}: {
  attendanceResult: AttendanceEfficiencyResult | null
  attendanceDailyCostPerTicket?: Record<string, number | null>
  attendanceDailyTotalLaborCost?: Record<string, number | null>
}): WeeklyCostSummary | null {
  if (!attendanceResult || !attendanceDailyTotalLaborCost) return null

  let totalLaborCost = 0
  let totalVolume = 0
  const dailySamples: Array<{ date: string; costPerTicket: number }> = []

  for (const row of attendanceResult.dailyRows) {
    if (!row.hasAttendance) continue
    const labor = attendanceDailyTotalLaborCost[row.date]
    if (labor == null || !Number.isFinite(labor) || labor < 0) continue
    totalLaborCost += labor
    if (row.volume > 0) {
      totalVolume += row.volume
      const c = attendanceDailyCostPerTicket?.[row.date]
      if (c != null && Number.isFinite(c) && c >= 0) {
        dailySamples.push({ date: row.date, costPerTicket: c })
      }
    }
  }

  if (!(totalVolume > 0) || totalLaborCost <= 0) return null
  const highestDay = getExtremeRow(dailySamples, (row) => row.costPerTicket, 'max')
  const lowestDay = getExtremeRow(dailySamples, (row) => row.costPerTicket, 'min')

  return {
    totalLaborCost,
    averageCostPerTicket: totalLaborCost / totalVolume,
    sampleDays: dailySamples.length,
    highestDay,
    lowestDay,
  }
}

export type ReportAnalysis = {
  conclusions: string[]
  diagnostics: { label: string; value: string; text: string }[]
  actions: string[]
  comparisons: WeeklyMetricComparison[]
  comparisonPeriodText: string
}

export const buildWeeklyReportAnalysis = ({
  scanAggregate,
  attendanceResult,
  scannerResult,
  sourceInfo,
  attendanceSourceInfo,
  currentSnapshot,
  previousSnapshot,
  attendanceDailyCostPerTicket,
  attendanceDailyTotalLaborCost,
}: {
  scanAggregate: ScanAggregate | null
  attendanceResult: AttendanceEfficiencyResult | null
  scannerResult: ScannerEfficiencyResult | null
  sourceInfo: SourceInfo
  attendanceSourceInfo: SourceInfo
  currentSnapshot?: WeeklyReportSnapshot | null
  previousSnapshot?: WeeklyReportSnapshot | null
  attendanceDailyCostPerTicket?: Record<string, number | null>
  attendanceDailyTotalLaborCost?: Record<string, number | null>
}): ReportAnalysis => {
  const conclusions: string[] = []
  const diagnostics: { label: string; value: string; text: string }[] = []
  const actions: string[] = []
  const comparisons: WeeklyMetricComparison[] = []
  let comparisonPeriodText = ''
  const dailyVolumeRows = scanAggregate?.dailyRows || []
  const totalVolume = scanAggregate?.summary?.totalVolume || 0
  const avgDailyVolume = dailyVolumeRows.length ? totalVolume / dailyVolumeRows.length : 0
  const peakVolumeDay = getExtremeRow(dailyVolumeRows, (row) => row.volume, 'max')

  conclusions.push(
    peakVolumeDay
      ? wt('weekly.analysis.volumeSummaryWithPeak', {
          total: formatInteger(totalVolume),
          avg: formatInteger(avgDailyVolume),
          date: peakVolumeDay.date,
          peak: formatInteger(peakVolumeDay.volume),
        })
      : wt('weekly.analysis.volumeSummary', { total: formatInteger(totalVolume) }),
  )

  if (attendanceResult) {
    const summary = attendanceResult.summary
    const matchedScanDayCount = attendanceResult.dailyRows.filter(
      (row) => row.hasAttendance && !row.isAttendanceOnly,
    ).length
    const matchedRate = dailyVolumeRows.length ? (matchedScanDayCount / dailyVolumeRows.length) * 100 : 0
    const efficientRows = attendanceResult.dailyRows.filter((row) => row.hasAttendance && row.dayEfficiency != null)
    const lowestWarehouseDay = getExtremeRow(efficientRows, (row) => row.dayEfficiency!, 'min')
    const openVsOverallRatio = summary.overallEfficiency > 0 ? summary.openEfficiency / summary.overallEfficiency : null

    conclusions.push(
      wt('weekly.analysis.warehouseSummary', {
        openDays: formatInteger(summary.openDayCount),
        openEff: formatNumber(summary.openEfficiency, 2),
        overallEff: formatNumber(summary.overallEfficiency, 2),
      }),
    )

    diagnostics.push({
      label: wt('weekly.analysis.matchLabel'),
      value: `${formatNumber(matchedRate, 1)}%`,
      text: summary.unmatchedDayCount
        ? wt('weekly.analysis.matchIncomplete', { days: formatInteger(summary.unmatchedDayCount) })
        : wt('weekly.analysis.matchComplete'),
    })

    diagnostics.push({
      label: wt('weekly.analysis.openEffLabel'),
      value: `${formatNumber(summary.openEfficiency, 2)} ${wt('weekly.metric.unitTicketsPerHour')}`,
      text:
        openVsOverallRatio == null
          ? wt('weekly.analysis.noOverallCompare')
          : openVsOverallRatio >= 1
            ? wt('weekly.analysis.openAboveOverall', { pct: formatNumber((openVsOverallRatio - 1) * 100, 1) })
            : wt('weekly.analysis.openBelowOverall', { pct: formatNumber((1 - openVsOverallRatio) * 100, 1) }),
    })

    if (lowestWarehouseDay) {
      actions.push(
        wt('weekly.analysis.reviewLowDay', {
          date: lowestWarehouseDay.date,
          eff: formatNumber(lowestWarehouseDay.dayEfficiency!, 2),
        }),
      )
    }
    if (summary.unmatchedDayCount) {
      actions.push(
        wt('weekly.analysis.fillUnmatched', {
          dates: summary.unmatchedDates.slice(0, 3).join(listSep()),
        }),
      )
    }

    const weeklyCostSummary = summarizeWeeklyCost({
      attendanceResult,
      attendanceDailyCostPerTicket,
      attendanceDailyTotalLaborCost,
    })
    if (weeklyCostSummary) {
      conclusions.push(
        wt('weekly.analysis.laborCostSummary', {
          cost: formatNumber(weeklyCostSummary.totalLaborCost, 2),
          unit: formatNumber(weeklyCostSummary.averageCostPerTicket, 2),
        }),
      )
      const spread =
        weeklyCostSummary.highestDay && weeklyCostSummary.lowestDay
          ? wt('weekly.analysis.costSpread', {
              highDate: weeklyCostSummary.highestDay.date,
              high: formatNumber(weeklyCostSummary.highestDay.costPerTicket, 2),
              lowDate: weeklyCostSummary.lowestDay.date,
              low: formatNumber(weeklyCostSummary.lowestDay.costPerTicket, 2),
            })
          : wt('weekly.analysis.costInsufficient')
      diagnostics.push({
        label: wt('weekly.metric.averageCostPerTicket'),
        value: `$${formatNumber(weeklyCostSummary.averageCostPerTicket, 2)}/${wt('weekly.metric.unitTickets')}`,
        text: spread,
      })
      if (
        weeklyCostSummary.highestDay &&
        weeklyCostSummary.lowestDay &&
        weeklyCostSummary.lowestDay.costPerTicket > 0
      ) {
        const ratio =
          weeklyCostSummary.highestDay.costPerTicket / weeklyCostSummary.lowestDay.costPerTicket
        if (ratio >= 1.25) {
          actions.push(
            wt('weekly.email.reviewCostPeak', {
              date: weeklyCostSummary.highestDay.date,
              pct: formatNumber((ratio - 1) * 100, 1),
            }),
          )
        }
      }
    } else {
      diagnostics.push({
        label: wt('weekly.metric.averageCostPerTicket'),
        value: wt('weekly.analysis.costInsufficientLabel'),
        text: wt('weekly.analysis.costInsufficientText'),
      })
    }
  } else {
    diagnostics.push({
      label: wt('weekly.analysis.attendanceDisabledLabel'),
      value: wt('weekly.analysis.attendanceDisabledValue'),
      text: wt('weekly.analysis.attendanceDisabledText'),
    })
    actions.push(wt('weekly.analysis.addAttendanceAction'))
  }

  if (scannerResult) {
    const summary = scannerResult.summary
    const sortingRows = scannerResult.dailySummaryRows.filter((row) => Number.isFinite(row.efficiency))
    const lowestSortingDay = getExtremeRow(sortingRows, (row) => row.efficiency, 'min')
    const bestSortingDay = getExtremeRow(sortingRows, (row) => row.efficiency, 'max')
    const spreadText =
      lowestSortingDay && bestSortingDay && lowestSortingDay.date !== bestSortingDay.date
        ? wt('weekly.analysis.sortingSpread', {
            highDate: bestSortingDay.date,
            high: formatNumber(bestSortingDay.efficiency, 2),
            lowDate: lowestSortingDay.date,
            low: formatNumber(lowestSortingDay.efficiency, 2),
          })
        : wt('weekly.analysis.sortingFlat')

    conclusions.push(
      wt('weekly.analysis.sortingSummary', {
        eff: formatNumber(summary.totalEfficiency, 2),
        days: formatInteger(summary.totalDays),
        scanners: formatInteger(summary.totalScanners),
      }),
    )
    diagnostics.push({
      label: wt('weekly.analysis.sortingLabel'),
      value: `${formatNumber(summary.totalEfficiency, 2)} ${wt('weekly.metric.unitTicketsPerHour')}`,
      text: spreadText,
    })

    if (lowestSortingDay) {
      actions.push(
        wt('weekly.analysis.reviewSortingLow', {
          date: lowestSortingDay.date,
          eff: formatNumber(lowestSortingDay.efficiency, 2),
        }),
      )
    }
  } else {
    diagnostics.push({
      label: wt('weekly.analysis.sortingLabel'),
      value: wt('weekly.analysis.sortingDisabledValue'),
      text: wt('weekly.analysis.sortingDisabledText'),
    })
    actions.push(wt('weekly.analysis.sortingColumnsAction'))
  }

  if (peakVolumeDay && avgDailyVolume > 0 && peakVolumeDay.volume >= avgDailyVolume * 1.3) {
    diagnostics.push({
      label: wt('weekly.analysis.volumeSpikeLabel'),
      value: `${formatNumber(peakVolumeDay.volume / avgDailyVolume, 1)}x`,
      text: wt('weekly.analysis.volumeSpikeText', { date: peakVolumeDay.date }),
    })
  }

  if (sourceInfo.duplicateWaybillRows > 0) {
    diagnostics.push({
      label: wt('weekly.analysis.dedupeLabel'),
      value: formatInteger(sourceInfo.duplicateWaybillRows),
      text: wt('weekly.analysis.dedupeText'),
    })
  }

  if (sourceInfo.droppedRows || attendanceSourceInfo.droppedRows) {
    actions.push(
      wt('weekly.analysis.checkInvalidRows', {
        scanDropped: formatInteger(sourceInfo.droppedRows),
        attendanceDropped: formatInteger(attendanceSourceInfo.droppedRows),
      }),
    )
  }

  if (currentSnapshot && previousSnapshot) {
    const comparison = buildWeeklySnapshotComparison(currentSnapshot, previousSnapshot)
    comparisonPeriodText = comparison.previousPeriodText
    comparisons.push(...comparison.rows)
    conclusions.push(...comparison.conclusions)
    diagnostics.push(...comparison.diagnostics)
    actions.push(...comparison.actions)
  }

  if (!actions.length) {
    actions.push(wt('weekly.actionDefault'))
  }

  return { conclusions, diagnostics, actions, comparisons, comparisonPeriodText }
}

export function buildWeeklyReportEmailHtml({
  scanAggregate,
  attendanceResult,
  scannerResult,
  sourceInfo,
  attendanceSourceInfo,
  currentSnapshot,
  previousSnapshot,
  aiAnalysis,
  attendanceDailyCostPerTicket,
  attendanceDailyTotalLaborCost,
}: {
  scanAggregate: ScanAggregate | null
  attendanceResult: AttendanceEfficiencyResult | null
  scannerResult: ScannerEfficiencyResult | null
  sourceInfo: SourceInfo
  attendanceSourceInfo: SourceInfo
  currentSnapshot?: WeeklyReportSnapshot | null
  previousSnapshot?: WeeklyReportSnapshot | null
  aiAnalysis?: WeeklyAiAnalysis | null
  attendanceDailyCostPerTicket?: Record<string, number | null>
  attendanceDailyTotalLaborCost?: Record<string, number | null>
}): string {
  if (!scanAggregate || !scanAggregate.dailyRows.length) return ''

  const periodResolved = resolveWeeklyReportPeriod(scanAggregate, attendanceResult)
  const periodText = periodResolved
    ? formatWeeklyReportPeriodText(periodResolved.startDate, periodResolved.endDate)
    : ''
  const narrativeParts: string[] = []
  if (attendanceResult) {
    narrativeParts.push(
      buildWeeklySummaryText({
        scanAggregate,
        attendanceResult,
        scannerResult,
        reportMode: TAB_KEYS.WAREHOUSE,
        attendanceDailyCostPerTicket,
        attendanceDailyTotalLaborCost,
      }),
    )
  }
  if (scannerResult) {
    narrativeParts.push(
      buildWeeklySummaryText({
        scanAggregate,
        attendanceResult,
        scannerResult,
        reportMode: TAB_KEYS.SCANNER,
        attendanceDailyCostPerTicket,
        attendanceDailyTotalLaborCost,
      }),
    )
  }
  if (!attendanceResult && !scannerResult) {
    narrativeParts.push(
      buildWeeklySummaryText({
        scanAggregate,
        attendanceResult,
        scannerResult,
        reportMode: TAB_KEYS.WAREHOUSE,
        attendanceDailyCostPerTicket,
        attendanceDailyTotalLaborCost,
      }),
    )
  }
  const summaryText = narrativeParts.join(' ')

  const reportAnalysis = buildWeeklyReportAnalysis({
    scanAggregate,
    attendanceResult,
    scannerResult,
    sourceInfo,
    attendanceSourceInfo,
    currentSnapshot,
    previousSnapshot,
    attendanceDailyCostPerTicket,
    attendanceDailyTotalLaborCost,
  })
  const conclusionHtml = reportAnalysis.conclusions
    .map(
      (text) => `
              <li style="margin:0 0 8px;padding-left:2px;line-height:1.75;">${escapeHtml(text)}</li>
            `,
    )
    .join('')
  const diagnosticsHtml = reportAnalysis.diagnostics
    .map(
      (item) => `
              <tr>
                <td style="padding:11px 12px;border-bottom:1px solid #e8edf3;font-weight:700;color:#184a7a;">${escapeHtml(
                  item.label,
                )}</td>
                <td style="padding:11px 12px;border-bottom:1px solid #e8edf3;text-align:right;font-weight:800;color:#0f996b;white-space:nowrap;">${escapeHtml(
                  item.value,
                )}</td>
                <td style="padding:11px 12px;border-bottom:1px solid #e8edf3;color:#4a6785;line-height:1.65;">${escapeHtml(
                  item.text,
                )}</td>
              </tr>
            `,
    )
    .join('')
  const actionsHtml = reportAnalysis.actions
    .map(
      (text, index) => `
              <tr>
                <td style="width:34px;padding:9px 0 9px 0;vertical-align:top;">
                  <div style="width:24px;height:24px;border-radius:999px;background:#eaf5ff;color:#0068d6;text-align:center;line-height:24px;font-size:12px;font-weight:800;">${index + 1}</div>
                </td>
                <td style="padding:9px 0;color:#29435f;font-size:13px;line-height:1.75;">${escapeHtml(text)}</td>
              </tr>
            `,
    )
    .join('')
  const analysisHtmlFallback = `
          <tr>
            <td style="padding:22px 32px 4px;">
              <div style="font-size:17px;font-weight:800;color:#184a7a;">${escapeHtml(wt('weekly.email.conclusionsTitle'))}</div>
              <ul style="margin:10px 0 0 18px;padding:0;color:#29435f;font-size:14px;">
                ${conclusionHtml}
              </ul>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px 4px;">
              <div style="font-size:17px;font-weight:800;color:#184a7a;">${escapeHtml(wt('weekly.email.diagnosticsTitle'))}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid #d9eaff;border-radius:12px;overflow:hidden;">
                <tr style="background:#f4f9ff;color:#184a7a;">
                  <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:800;">${escapeHtml(wt('weekly.email.colMetric'))}</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:800;">${escapeHtml(wt('weekly.email.colResult'))}</th>
                  <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:800;">${escapeHtml(wt('weekly.email.colJudgment'))}</th>
                </tr>
                ${diagnosticsHtml}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px 4px;">
              <div style="font-size:17px;font-weight:800;color:#184a7a;">${escapeHtml(wt('weekly.email.actionsTitle'))}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                ${actionsHtml}
              </table>
            </td>
          </tr>
        `

  const aiSummaryHtml = (aiAnalysis?.summary || [])
    .map(
      (text) => `
              <li style="margin:0 0 8px;padding-left:2px;line-height:1.75;">${escapeHtml(text)}</li>
            `,
    )
    .join('')
  const aiPredictionHtml = (aiAnalysis?.prediction || [])
    .map(
      (text) => `
              <li style="margin:0 0 8px;padding-left:2px;line-height:1.75;">${escapeHtml(text)}</li>
            `,
    )
    .join('')
  const aiPreventionHtml = (aiAnalysis?.prevention || [])
    .map(
      (text, index) => `
              <tr>
                <td style="width:34px;padding:9px 0 9px 0;vertical-align:top;">
                  <div style="width:24px;height:24px;border-radius:999px;background:#eaf5ff;color:#0068d6;text-align:center;line-height:24px;font-size:12px;font-weight:800;">${index + 1}</div>
                </td>
                <td style="padding:9px 0;color:#29435f;font-size:13px;line-height:1.75;">${escapeHtml(text)}</td>
              </tr>
            `,
    )
    .join('')
  const hasAiNarrative = Boolean(aiSummaryHtml || aiPredictionHtml || aiPreventionHtml)
  const analysisHtmlAi = `
          <tr>
            <td style="padding:22px 32px 4px;">
              <div style="font-size:17px;font-weight:800;color:#184a7a;">${escapeHtml(wt('weekly.email.aiSummaryTitle'))}</div>
              <ul style="margin:10px 0 0 18px;padding:0;color:#29435f;font-size:14px;">
                ${aiSummaryHtml || `<li style="line-height:1.75;color:#64748b;">${escapeHtml(wt('weekly.email.aiSummaryEmpty'))}</li>`}
              </ul>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px 4px;">
              <div style="font-size:17px;font-weight:800;color:#184a7a;">${escapeHtml(wt('weekly.email.aiPredictionTitle'))}</div>
              <ul style="margin:10px 0 0 18px;padding:0;color:#29435f;font-size:14px;">
                ${aiPredictionHtml || `<li style="line-height:1.75;color:#64748b;">${escapeHtml(wt('weekly.email.aiPredictionEmpty'))}</li>`}
              </ul>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px 4px;">
              <div style="font-size:17px;font-weight:800;color:#184a7a;">${escapeHtml(wt('weekly.email.aiPreventionTitle'))}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                ${aiPreventionHtml || `<tr><td style="color:#64748b;font-size:13px;line-height:1.75;">${escapeHtml(wt('weekly.email.aiPreventionEmpty'))}</td></tr>`}
              </table>
            </td>
          </tr>
        `
  const analysisHtml = hasAiNarrative ? analysisHtmlAi : analysisHtmlFallback

  const comparisonRowsHtml = reportAnalysis.comparisons
    .map((row) => {
      const deltaPrefix = row.deltaValue > 0 ? '+' : ''
      const deltaValueText = `${deltaPrefix}${formatWeeklyMetricDeltaValue(row.key, row.deltaValue)}`
      const deltaPercentText =
        row.deltaPercent == null
          ? '-'
          : `${row.deltaPercent >= 0 ? '+' : ''}${formatNumber(row.deltaPercent, 1)}%`
      const color =
        row.assessment === 'positive' ? '#0f996b' : row.assessment === 'negative' ? '#c2410c' : '#4a6785'

      return `
                <tr>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;font-weight:700;color:#184a7a;">${escapeHtml(
                    row.label,
                  )}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;white-space:nowrap;">${escapeHtml(
                    formatWeeklyMetricValue(row.key, row.currentValue),
                  )}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;white-space:nowrap;">${escapeHtml(
                    formatWeeklyMetricValue(row.key, row.previousValue),
                  )}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;font-weight:800;color:${color};white-space:nowrap;">${escapeHtml(
                    deltaValueText,
                  )}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;font-weight:800;color:${color};white-space:nowrap;">${escapeHtml(
                    deltaPercentText,
                  )}</td>
                </tr>
              `
    })
    .join('')

  const comparisonHtml = comparisonRowsHtml
    ? `
            <tr>
              <td style="padding:18px 32px 4px;">
                <div style="font-size:17px;font-weight:800;color:#184a7a;">${escapeHtml(wt('weekly.email.comparisonTitle'))}</div>
                <div style="margin-top:4px;color:#58708b;font-size:12px;">${escapeHtml(wt('weekly.email.comparisonPeriod', { period: reportAnalysis.comparisonPeriodText }))}</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid #d9eaff;border-radius:12px;overflow:hidden;">
                  <tr style="background:#f4f9ff;color:#184a7a;">
                    <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:800;">${escapeHtml(wt('weekly.email.colMetric'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:800;">${escapeHtml(wt('weekly.email.colThisWeek'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:800;">${escapeHtml(wt('weekly.email.colLastWeek'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:800;">${escapeHtml(wt('weekly.email.colDelta'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:800;">${escapeHtml(wt('weekly.email.colChange'))}</th>
                  </tr>
                  ${comparisonRowsHtml}
                </table>
              </td>
            </tr>
          `
    : ''

  const metricCard = (
    label: string,
    value: string,
    border: string,
    bg: string,
    labelColor: string,
    valueColor: string,
  ) => `
          <td style="padding:14px;border:1px solid ${border};border-radius:16px;background:${bg};">
            <div style="font-size:12px;color:${labelColor};text-transform:uppercase;letter-spacing:0.12em;font-weight:600;">${label}</div>
            <div style="margin-top:8px;font-size:24px;font-weight:800;color:${valueColor};line-height:1.15;">${value}</div>
          </td>`
  const gap = `<td width="12"></td>`
  const metricRowColSpan = 3

  const metricRows: string[] = []
  const openDayCountValue = attendanceResult
    ? attendanceResult.summary.openDayCount
    : scanAggregate.summary.totalDays
  metricRows.push(
    `<tr>${metricCard(
      wt('weekly.metric.totalVolume'),
      formatInteger(scanAggregate.summary.totalVolume),
      '#b9dcff',
      '#eaf5ff',
      '#3f5f80',
      '#0068d6',
    )}${gap}${metricCard(
      wt('weekly.metric.openDayCount'),
      formatInteger(openDayCountValue),
      '#b6ecd8',
      '#e9fbf3',
      '#3f6c63',
      '#0f996b',
    )}</tr>`,
  )

  if (attendanceResult) {
    metricRows.push(
      `<tr><td colspan="${metricRowColSpan}" style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr><tr>${metricCard(
        wt('weekly.metric.openEfficiency'),
        `${formatNumber(attendanceResult.summary.openEfficiency, 2)} ${wt('weekly.metric.unitTicketsPerHour')}`,
        '#b9dcff',
        '#eaf5ff',
        '#3f5f80',
        '#0068d6',
      )}${gap}${metricCard(
        wt('weekly.metric.overallEfficiency'),
        `${formatNumber(attendanceResult.summary.overallEfficiency, 2)} ${wt('weekly.metric.unitTicketsPerHour')}`,
        '#b6ecd8',
        '#e9fbf3',
        '#3f6c63',
        '#0f996b',
      )}</tr>`,
    )
  }

  const weeklyCostSummary = summarizeWeeklyCost({
    attendanceResult,
    attendanceDailyCostPerTicket,
    attendanceDailyTotalLaborCost,
  })
  if (weeklyCostSummary) {
    metricRows.push(
      `<tr><td colspan="${metricRowColSpan}" style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr><tr>${metricCard(
        wt('weekly.email.laborCostLabel'),
        `$${formatNumber(weeklyCostSummary.totalLaborCost, 2)}`,
        '#b9dcff',
        '#eaf5ff',
        '#3f5f80',
        '#0068d6',
      )}${gap}${metricCard(
        wt('weekly.email.unitCostLabel'),
        `$${formatNumber(weeklyCostSummary.averageCostPerTicket, 2)}/${wt('weekly.metric.unitTickets')}`,
        '#b6ecd8',
        '#e9fbf3',
        '#3f6c63',
        '#0f996b',
      )}</tr>`,
    )
  }

  if (scannerResult) {
    metricRows.push(
      `<tr><td colspan="${metricRowColSpan}" style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr><tr>${metricCard(
        wt('weekly.metric.sortingEfficiency'),
        `${formatNumber(scannerResult.summary.totalEfficiency, 2)} ${wt('weekly.metric.unitTicketsPerHour')}`,
        '#b9dcff',
        '#eaf5ff',
        '#3f5f80',
        '#0068d6',
      )}${gap}${metricCard(
        wt('weekly.metric.sortingScannerCount'),
        wt('weekly.email.scannerPeople', { count: formatInteger(scannerResult.summary.totalScanners) }),
        '#b6ecd8',
        '#e9fbf3',
        '#3f6c63',
        '#0f996b',
      )}</tr>`,
    )
  }

  const metricTableHtml = `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${metricRows.join('')}
          </table>`

  let extraBlockHtml = ''
  if (attendanceResult) {
    const sortingEfficiencyByDate = new Map(
      (scannerResult?.dailySummaryRows || []).map((row) => [row.date, row.efficiency]),
    )
    const weekRows = attendanceResult.dailyRows
    const matchAvgs = computeAttendanceDailyMatchAverages(weekRows)
    const footerVol = `${wt('weekly.email.footerTotalLine', { value: formatInteger(matchAvgs.totalVolume) })}<br/><span style="color:#64748b;font-weight:600;">${wt('weekly.email.footerAverageLine', { value: formatNumber(matchAvgs.avgVolume, 2) })}</span>`
    const footerHours = `${wt('weekly.email.footerTotalLine', { value: formatNumber(matchAvgs.totalHoursSum, 2) })}<br/><span style="color:#64748b;font-weight:600;">${wt('weekly.email.footerAverageLine', { value: formatNumber(matchAvgs.avgTotalHours, 2) })}</span>`
    const footerEffTotal =
      matchAvgs.efficiencyFromTotals == null ? '—' : formatNumber(matchAvgs.efficiencyFromTotals, 2)
    const footerEffAvg =
      matchAvgs.avgDayEfficiency == null ? '—' : formatNumber(matchAvgs.avgDayEfficiency, 2)
    const footerEff = `${wt('weekly.email.footerTotalLine', { value: footerEffTotal })}<br/><span style="color:#64748b;font-weight:600;">${wt('weekly.email.footerAverageLine', { value: footerEffAvg })}</span>`
    const costByDate = attendanceDailyCostPerTicket
    const costSamples = weekRows
      .map((row) => costByDate?.[row.date])
      .filter((v): v is number => v != null && Number.isFinite(v))
    const footerCostAvg =
      costSamples.length > 0
        ? formatNumber(costSamples.reduce((a, b) => a + b, 0) / costSamples.length, 2)
        : '—'
    const footerCost = `${wt('weekly.email.footerTotalLine', { value: '—' })}<br/><span style="color:#64748b;font-weight:600;">${wt('weekly.email.footerAverageLine', { value: footerCostAvg })}</span>`
    const matchRowsHtml = weekRows
      .map(
        (row) => {
          const c = costByDate?.[row.date]
          const costCell =
            row.hasAttendance && row.volume > 0 && c != null && Number.isFinite(c)
              ? formatNumber(c, 2)
              : '-'
          return `
                <tr>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;">${escapeHtml(row.date)}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;">${formatInteger(
                    row.volume,
                  )}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;">${
                    row.hasAttendance ? formatInteger(row.sorterCount) : '-'
                  }</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;">${
                    row.hasAttendance ? formatNumber(row.totalHours, 2) : '-'
                  }</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;">${
                    row.dayEfficiency == null ? '-' : formatNumber(row.dayEfficiency, 2)
                  }</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;">${costCell}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;">${
                    sortingEfficiencyByDate.has(row.date)
                      ? formatNumber(sortingEfficiencyByDate.get(row.date)!, 2)
                      : '-'
                  }</td>
                </tr>
              `
        },
      )
      .concat(
        `<tr style="font-weight:700;background:#f0f6ff;">
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;">${escapeHtml(wt('weekly.email.footerAvgTotal'))}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;line-height:1.35;">${footerVol}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;">—</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;line-height:1.35;">${footerHours}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;line-height:1.35;">${footerEff}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;line-height:1.35;">${footerCost}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;">—</td>
                </tr>`,
      )
      .join('')

    extraBlockHtml = `
            <tr>
              <td style="padding:18px 32px 8px;">
                <div style="font-size:16px;font-weight:800;color:#184a7a;">${escapeHtml(wt('weekly.email.weeklyEfficiencyTitle'))}</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid #d9eaff;border-radius:12px;overflow:hidden;">
                  <tr style="background:#2f84df;color:#ffffff;">
                    <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:700;">${escapeHtml(wt('weekly.email.colDate'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">${escapeHtml(wt('weekly.email.colVolume'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">${escapeHtml(wt('weekly.email.colSorterCount'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">${escapeHtml(wt('weekly.email.colTotalHours'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">${escapeHtml(wt('weekly.email.colDayEfficiency'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">${escapeHtml(wt('weekly.email.colCostPerTicket'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">${escapeHtml(wt('weekly.email.colSortingEff'))}</th>
                  </tr>
                  ${matchRowsHtml}
                </table>
              </td>
            </tr>
          `
  }

  let scannerBlockHtml = ''
  if (scannerResult) {
    const topScannerRows = scannerResult.scannerTotalRows.slice(0, 10)
    const scannerRowsHtml = topScannerRows
      .map(
        (row, index) => `
                <tr>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:center;">${index + 1}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;">${escapeHtml(row.scanner)}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;text-align:right;">${formatNumber(
                    row.adjustedEfficiency,
                    2,
                  )}</td>
                </tr>
              `,
      )
      .join('')

    scannerBlockHtml = `
            <tr>
              <td style="padding:18px 32px 8px;">
                <div style="font-size:16px;font-weight:800;color:#184a7a;">${escapeHtml(wt('weekly.email.scannerTopTitle', { count: Math.min(topScannerRows.length, 10) }))}</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid #d9eaff;border-radius:12px;overflow:hidden;">
                  <tr style="background:#2f84df;color:#ffffff;">
                    <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:700;">${escapeHtml(wt('weekly.email.colRank'))}</th>
                    <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:700;">${escapeHtml(wt('weekly.email.colScanner'))}</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">${escapeHtml(wt('weekly.email.colCombinedEff'))}</th>
                  </tr>
                  ${scannerRowsHtml}
                </table>
              </td>
            </tr>
          `
  }

  const modeTitle = wt('weekly.email.modeTitle')
  const reportTitle = wt('weekly.email.reportHeader')
  const periodLabel = wt('weekly.email.periodLabel')
  const statsModeLabel = wt('weekly.email.summaryNarrative')

  return `<!doctype html>
<html lang="${i18n.language.startsWith('en') ? 'en' : 'zh-CN'}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(reportTitle)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f2f8ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#243447;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f8ff;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="900" cellpadding="0" cellspacing="0" style="max-width:900px;width:100%;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #d7e8ff;">
            <tr>
              <td style="padding:30px 32px;background:linear-gradient(120deg,#1e88ff,#48c5ff,#7ee4c4);color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;opacity:0.95;">Logistics Operations Weekly</div>
                <div style="margin-top:10px;font-size:30px;font-weight:800;line-height:1.25;">${escapeHtml(reportTitle)}</div>
                <div style="margin-top:8px;font-size:15px;font-weight:500;opacity:0.95;">${escapeHtml(periodLabel)}：${escapeHtml(periodText)}</div>
                <div style="margin-top:8px;font-size:13px;font-weight:500;opacity:0.95;">${escapeHtml(statsModeLabel)}：${escapeHtml(modeTitle)}</div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 32px 8px;">
                ${metricTableHtml}
              </td>
            </tr>

            ${analysisHtml}
            ${comparisonHtml}

            <tr>
              <td style="padding:10px 32px 6px;">
                <div style="padding:10px 12px;border-radius:12px;background:#f4f9ff;border:1px solid #d5e8ff;font-size:13px;color:#4a6785;line-height:1.8;">
                  ${escapeHtml(summaryText)}
                </div>
              </td>
            </tr>

            ${extraBlockHtml}
            ${scannerBlockHtml}

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
