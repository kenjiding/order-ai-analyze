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
      ? `未匹配 ${summary.unmatchedDayCount} 天（${summary.unmatchedDates.join('、')}）。`
      : '到件日期全部完成考勤匹配。'
    return [
      `本期上传总货量 ${formatInteger(summary.uploadedVolume)} 票，匹配货量 ${formatInteger(summary.matchedVolume)} 票。`,
      `开仓效率 ${formatNumber(summary.openEfficiency, 2)} 票/小时（统计窗口内开仓日工时 ${formatNumber(summary.openHours, 2)} 小时）。`,
      `总体效率 ${formatNumber(summary.overallEfficiency, 2)} 票/小时（统计窗口内全部考勤工时 ${formatNumber(summary.allHours, 2)} 小时，窗口 ${summary.efficiencyRangeStart}～${summary.efficiencyRangeEnd}）。`,
      weeklyCostSummary
        ? `周人工总成本 $${formatNumber(weeklyCostSummary.totalLaborCost, 2)}，单位成本 $${formatNumber(weeklyCostSummary.averageCostPerTicket, 2)}/票。`
        : '',
      `开仓日 ${formatInteger(summary.openDayCount)} 天，${unmatchedText}`,
    ].join(' ')
  }

  if (effectiveMode === TAB_KEYS.SCANNER && scannerResult) {
    const { summary } = scannerResult
    return `小工效率 ${formatNumber(summary.totalEfficiency, 2)} 票/小时，覆盖 ${summary.totalDays} 天、${summary.totalScanners} 位扫描员。`
  }

  return `当前仅统计到件货量：${formatInteger(scanAggregate.summary.totalVolume)} 票，覆盖 ${scanAggregate.summary.totalDays} 天。`
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
  if (!period) return '仓库效率周报'
  return `仓库效率周报（${formatWeeklyReportPeriodText(period.startDate, period.endDate)}）`
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
      ? `本期总货量 ${formatInteger(totalVolume)} 票，日均 ${formatInteger(avgDailyVolume)} 票，峰值日为 ${peakVolumeDay.date}（${formatInteger(peakVolumeDay.volume)} 票）。`
      : `本期总货量 ${formatInteger(totalVolume)} 票。`,
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
      `开仓 ${formatInteger(summary.openDayCount)} 天，开仓效率 ${formatNumber(summary.openEfficiency, 2)} 票/小时，总体效率 ${formatNumber(summary.overallEfficiency, 2)} 票/小时。`,
    )

    diagnostics.push({
      label: '数据匹配',
      value: `${formatNumber(matchedRate, 1)}%`,
      text: summary.unmatchedDayCount
        ? `仍有 ${formatInteger(summary.unmatchedDayCount)} 天到件未匹配考勤，效率口径需要优先补齐。`
        : '到件与考勤日期匹配完整，周效率口径可信度较高。',
    })

    diagnostics.push({
      label: '开仓效率',
      value: `${formatNumber(summary.openEfficiency, 2)} 票/小时`,
      text:
        openVsOverallRatio == null
          ? '暂无总体效率对照。'
          : openVsOverallRatio >= 1
            ? `高于总体效率 ${formatNumber((openVsOverallRatio - 1) * 100, 1)}%，开仓日资源利用相对更集中。`
            : `低于总体效率 ${formatNumber((1 - openVsOverallRatio) * 100, 1)}%，建议复核开仓日定义、排班与货量匹配。`,
    })

    if (lowestWarehouseDay) {
      actions.push(
        `复盘 ${lowestWarehouseDay.date} 的周效率：当天效率 ${formatNumber(lowestWarehouseDay.dayEfficiency!, 2)} 票/小时，优先核对工时、货量结构和人员配置。`,
      )
    }
    if (summary.unmatchedDayCount) {
      actions.push(`补齐 ${summary.unmatchedDates.slice(0, 3).join('、')} 等未匹配日期的数据，避免周报结论被缺口拉偏。`)
    }

    const weeklyCostSummary = summarizeWeeklyCost({
      attendanceResult,
      attendanceDailyCostPerTicket,
      attendanceDailyTotalLaborCost,
    })
    if (weeklyCostSummary) {
      conclusions.push(
        `人工总成本 $${formatNumber(weeklyCostSummary.totalLaborCost, 2)}，单位成本 $${formatNumber(weeklyCostSummary.averageCostPerTicket, 2)}/票（总成本÷总货量）。`,
      )
      const spread =
        weeklyCostSummary.highestDay && weeklyCostSummary.lowestDay
          ? `最高 ${weeklyCostSummary.highestDay.date}（$${formatNumber(weeklyCostSummary.highestDay.costPerTicket, 2)}/票），最低 ${weeklyCostSummary.lowestDay.date}（$${formatNumber(weeklyCostSummary.lowestDay.costPerTicket, 2)}/票）。`
          : '样本不足，暂不评价日间波动。'
      diagnostics.push({
        label: '每票成本',
        value: `$${formatNumber(weeklyCostSummary.averageCostPerTicket, 2)}/票`,
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
            `复盘 ${weeklyCostSummary.highestDay.date} 的成本峰值日：每票成本较低位日高 ${formatNumber((ratio - 1) * 100, 1)}%，重点检查异常工时和低货量错配。`,
          )
        }
      }
    } else {
      diagnostics.push({
        label: '每票成本',
        value: '样本不足',
        text: '缺少有效的“有考勤且有货量”样本日，暂不输出周成本结论。',
      })
    }
  } else {
    diagnostics.push({
      label: '考勤口径',
      value: '未启用',
      text: '缺少考勤数据，暂时无法判断开仓效率、总体效率和排班投入产出。',
    })
    actions.push('补充考勤文件后再生成周报，管理结论会从货量统计升级为效率复盘。')
  }

  if (scannerResult) {
    const summary = scannerResult.summary
    const sortingRows = scannerResult.dailySummaryRows.filter((row) => Number.isFinite(row.efficiency))
    const lowestSortingDay = getExtremeRow(sortingRows, (row) => row.efficiency, 'min')
    const bestSortingDay = getExtremeRow(sortingRows, (row) => row.efficiency, 'max')
    const spreadText =
      lowestSortingDay && bestSortingDay && lowestSortingDay.date !== bestSortingDay.date
        ? `最高日 ${bestSortingDay.date}（${formatNumber(bestSortingDay.efficiency, 2)}），最低日 ${lowestSortingDay.date}（${formatNumber(lowestSortingDay.efficiency, 2)}）。`
        : '日间波动较小或样本不足。'

    conclusions.push(
      `小工平均效率 ${formatNumber(summary.totalEfficiency, 2)} 票/小时，覆盖 ${formatInteger(summary.totalDays)} 天、${formatInteger(summary.totalScanners)} 位扫描员。`,
    )
    diagnostics.push({
      label: '小工',
      value: `${formatNumber(summary.totalEfficiency, 2)} 票/小时`,
      text: spreadText,
    })

    if (lowestSortingDay) {
      actions.push(
        `对照 ${lowestSortingDay.date} 的小工效率（${formatNumber(lowestSortingDay.efficiency, 2)} 票/小时），检查扫描间隔、任务分配和人员熟练度。`,
      )
    }
  } else {
    diagnostics.push({
      label: '小工',
      value: '未启用',
      text: '当前文件没有形成小工效率，无法做分拣端对照分析。',
    })
    actions.push('确认到件文件包含小工效率所需的扫描时间、运单号、扫描员字段。')
  }

  if (peakVolumeDay && avgDailyVolume > 0 && peakVolumeDay.volume >= avgDailyVolume * 1.3) {
    diagnostics.push({
      label: '货量波动',
      value: `${formatNumber(peakVolumeDay.volume / avgDailyVolume, 1)}x`,
      text: `${peakVolumeDay.date} 货量高于日均较多，建议与当天工时和效率联动判断是否需要临时增援。`,
    })
  }

  if (sourceInfo.duplicateWaybillRows > 0) {
    diagnostics.push({
      label: '到件重复运单剔除',
      value: formatInteger(sourceInfo.duplicateWaybillRows),
      text: `已按全局「运单号」去重合并，较晚出现的重复扫描记录未纳入货量与个人效率口径。`,
    })
  }

  if (sourceInfo.droppedRows || attendanceSourceInfo.droppedRows) {
    actions.push(
      `检查原始文件无效行：到件 ${formatInteger(sourceInfo.droppedRows)} 行，考勤 ${formatInteger(attendanceSourceInfo.droppedRows)} 行。`,
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
    actions.push('延续当前口径，下周重点比较货量峰值日、开仓效率和小工效率是否同向改善。')
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
              <div style="font-size:17px;font-weight:800;color:#184a7a;">本周结论</div>
              <ul style="margin:10px 0 0 18px;padding:0;color:#29435f;font-size:14px;">
                ${conclusionHtml}
              </ul>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px 4px;">
              <div style="font-size:17px;font-weight:800;color:#184a7a;">效率诊断</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid #d9eaff;border-radius:12px;overflow:hidden;">
                <tr style="background:#f4f9ff;color:#184a7a;">
                  <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:800;">指标</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:800;">结果</th>
                  <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:800;">判断</th>
                </tr>
                ${diagnosticsHtml}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px 4px;">
              <div style="font-size:17px;font-weight:800;color:#184a7a;">下周动作</div>
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
              <div style="font-size:17px;font-weight:800;color:#184a7a;">本周要点</div>
              <ul style="margin:10px 0 0 18px;padding:0;color:#29435f;font-size:14px;">
                ${aiSummaryHtml || '<li style="line-height:1.75;color:#64748b;">本期暂无补充要点。</li>'}
              </ul>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px 4px;">
              <div style="font-size:17px;font-weight:800;color:#184a7a;">下周研判</div>
              <ul style="margin:10px 0 0 18px;padding:0;color:#29435f;font-size:14px;">
                ${aiPredictionHtml || '<li style="line-height:1.75;color:#64748b;">暂无研判内容。</li>'}
              </ul>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px 4px;">
              <div style="font-size:17px;font-weight:800;color:#184a7a;">预防与动作</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                ${aiPreventionHtml || '<tr><td style="color:#64748b;font-size:13px;line-height:1.75;">暂无预防与动作清单。</td></tr>'}
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
                <div style="font-size:17px;font-weight:800;color:#184a7a;">环比上周</div>
                <div style="margin-top:4px;color:#58708b;font-size:12px;">对比周期：${escapeHtml(
                  reportAnalysis.comparisonPeriodText,
                )}</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid #d9eaff;border-radius:12px;overflow:hidden;">
                  <tr style="background:#f4f9ff;color:#184a7a;">
                    <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:800;">指标</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:800;">本周</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:800;">上周</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:800;">差值</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:800;">变化</th>
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
      '总货量',
      formatInteger(scanAggregate.summary.totalVolume),
      '#b9dcff',
      '#eaf5ff',
      '#3f5f80',
      '#0068d6',
    )}${gap}${metricCard(
      '开仓天数',
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
        '开仓效率',
        `${formatNumber(attendanceResult.summary.openEfficiency, 2)} 票/小时`,
        '#b9dcff',
        '#eaf5ff',
        '#3f5f80',
        '#0068d6',
      )}${gap}${metricCard(
        '总体效率',
        `${formatNumber(attendanceResult.summary.overallEfficiency, 2)} 票/小时`,
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
        '人工总成本',
        `$${formatNumber(weeklyCostSummary.totalLaborCost, 2)}`,
        '#b9dcff',
        '#eaf5ff',
        '#3f5f80',
        '#0068d6',
      )}${gap}${metricCard(
        '单位成本',
        `$${formatNumber(weeklyCostSummary.averageCostPerTicket, 2)}/票`,
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
        '小工效率',
        `${formatNumber(scannerResult.summary.totalEfficiency, 2)} 票/小时`,
        '#b9dcff',
        '#eaf5ff',
        '#3f5f80',
        '#0068d6',
      )}${gap}${metricCard(
        '扫描员人数',
        `${formatInteger(scannerResult.summary.totalScanners)} 人`,
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
    const footerVol = `总计 ${formatInteger(matchAvgs.totalVolume)}<br/><span style="color:#64748b;font-weight:600;">平均 ${formatNumber(matchAvgs.avgVolume, 2)}</span>`
    const footerHours = `总计 ${formatNumber(matchAvgs.totalHoursSum, 2)}<br/><span style="color:#64748b;font-weight:600;">平均 ${formatNumber(matchAvgs.avgTotalHours, 2)}</span>`
    const footerEffTotal =
      matchAvgs.efficiencyFromTotals == null ? '—' : formatNumber(matchAvgs.efficiencyFromTotals, 2)
    const footerEffAvg =
      matchAvgs.avgDayEfficiency == null ? '—' : formatNumber(matchAvgs.avgDayEfficiency, 2)
    const footerEff = `总计 ${footerEffTotal}<br/><span style="color:#64748b;font-weight:600;">平均 ${footerEffAvg}</span>`
    const costByDate = attendanceDailyCostPerTicket
    const costSamples = weekRows
      .map((row) => costByDate?.[row.date])
      .filter((v): v is number => v != null && Number.isFinite(v))
    const footerCostAvg =
      costSamples.length > 0
        ? formatNumber(costSamples.reduce((a, b) => a + b, 0) / costSamples.length, 2)
        : '—'
    const footerCost = `总计 —<br/><span style="color:#64748b;font-weight:600;">平均 ${footerCostAvg}</span>`
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
                  <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;">${escapeHtml('平均 / 总计')}</td>
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
                <div style="font-size:16px;font-weight:800;color:#184a7a;">周效率</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid #d9eaff;border-radius:12px;overflow:hidden;">
                  <tr style="background:#2f84df;color:#ffffff;">
                    <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:700;">日期</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">货量</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">分拣人数</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">总工时</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">当天效率</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">每票成本</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">小工效率</th>
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
                <div style="font-size:16px;font-weight:800;color:#184a7a;">小工个人效率（Top ${Math.min(
                  topScannerRows.length,
                  10,
                )}）</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid #d9eaff;border-radius:12px;overflow:hidden;">
                  <tr style="background:#2f84df;color:#ffffff;">
                    <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:700;">排名</th>
                    <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:700;">扫描员</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;">综合效率</th>
                  </tr>
                  ${scannerRowsHtml}
                </table>
              </td>
            </tr>
          `
  }

  const modeTitle = '全口径综合（到件 + 开仓/总体 + 小工）'

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>仓库效率周报</title>
  </head>
  <body style="margin:0;padding:0;background:#f2f8ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#243447;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f8ff;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="900" cellpadding="0" cellspacing="0" style="max-width:900px;width:100%;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #d7e8ff;">
            <tr>
              <td style="padding:30px 32px;background:linear-gradient(120deg,#1e88ff,#48c5ff,#7ee4c4);color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;opacity:0.95;">Warehouse Weekly Efficiency</div>
                <div style="margin-top:10px;font-size:30px;font-weight:800;line-height:1.25;">仓库效率周报</div>
                <div style="margin-top:8px;font-size:15px;font-weight:500;opacity:0.95;">统计周期：${escapeHtml(periodText)}</div>
                <div style="margin-top:8px;font-size:13px;font-weight:500;opacity:0.95;">统计模式：${escapeHtml(modeTitle)}</div>
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
