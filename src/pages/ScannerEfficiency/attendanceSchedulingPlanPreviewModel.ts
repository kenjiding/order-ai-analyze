import type { AttendanceEfficiencyResult, ParsedAttendanceRow, ScannerEfficiencyResult } from './aggregates'
import type { OperatorAttendancePlanRow } from './attendanceSchedulingPlanOperators'
import { resolveOperatorAttendancePlanRows } from './attendanceSchedulingPlanOperators'
import { formatCainiaoSharePercent } from './cainiaoWaybill'
import type { DailyLaborCostMetrics } from '../../payroll/laborCostFromAttendance'
import {
  buildAttendanceSchedulingPlanSnapshot,
  COARSE_SORT_TARGET_EFFICIENCY,
  formatCostPerTicketDisplay,
  formatTotalLaborCostDisplay,
  OVERALL_TARGET_EFFICIENCY,
  OVERALL_COST_PER_TICKET_NOTE,
  OVERALL_TOTAL_HOURS_NOTE,
  resolveOpenPlanDates,
  type AttendanceSchedulingPlanSnapshot,
} from './exportAttendanceSchedulingPlanExcel'

export type PlanPreviewCellTone = 'default' | 'red' | 'green'

export type PlanPreviewCellEmphasis = 'label' | 'metric' | 'ratio' | 'feedback' | 'note'

export type PlanPreviewCell = {
  key: string
  text: string
  colSpan?: number
  tone?: PlanPreviewCellTone
  align?: 'center' | 'left'
  editable?: boolean
  variant?: 'title' | 'section' | 'header' | 'body'
  emphasis?: PlanPreviewCellEmphasis
}

export type PlanPreviewTable = {
  columns: 7 | 10
  rows: PlanPreviewCell[][]
}

export type AttendanceSchedulingPlanPreview = {
  planDate: string
  title: string
  tables: PlanPreviewTable[]
}

function formatPercent(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return ''
  return `${Math.round(ratio * 100)}%`
}

function formatEfficiency(value: number | ''): string {
  if (value === '') return ''
  return String(value)
}

function formatOverallCainiaoFeedback(share: number | null | undefined): string {
  const percent = formatCainiaoSharePercent(share)
  return percent === '—' ? '菜鸟件占比—' : `菜鸟件占比${percent}`
}

function cell(
  key: string,
  text: string,
  opts: Partial<Omit<PlanPreviewCell, 'key' | 'text'>> = {},
): PlanPreviewCell {
  const variant = opts.variant ?? 'body'
  const align =
    opts.align ??
    (variant === 'section' || variant === 'header' || variant === 'title' ? 'center' : undefined)
  return { key, text, editable: opts.editable ?? false, ...opts, align }
}

function labelCell(key: string, text: string, colSpan?: number): PlanPreviewCell {
  return cell(key, text, { variant: 'body', align: 'center', emphasis: 'label', colSpan })
}

function bodyValue(key: string, text: string, tone: PlanPreviewCellTone = 'default'): PlanPreviewCell {
  return cell(key, text, { editable: true, tone, variant: 'body', align: 'center', emphasis: 'metric' })
}

function ratioValue(key: string, text: string, tone: PlanPreviewCellTone): PlanPreviewCell {
  return cell(key, text, { editable: true, tone, variant: 'body', align: 'center', emphasis: 'ratio' })
}

function noteCell(key: string, text: string): PlanPreviewCell {
  return cell(key, text, { variant: 'body', align: 'left', emphasis: 'note' })
}

function buildTablesFromSnapshot(
  planDate: string,
  snap: AttendanceSchedulingPlanSnapshot,
  operatorRows: OperatorAttendancePlanRow[],
): PlanPreviewTable[] {
  const p = (suffix: string) => `${planDate}:${suffix}`

  const mainRows: PlanPreviewCell[][] = [
    [cell(p('title'), snap.sheetTitle, { colSpan: 7, variant: 'title' })],
    [],
    [cell(p('sec-overall'), '总体情况', { colSpan: 7, variant: 'section' })],
    [
      labelCell(p('ov-l1'), '预计入站件量'),
      bodyValue(p('ov-v1'), String(snap.totalVolume)),
      labelCell(p('ov-l2'), '预计总工时/h'),
      bodyValue(p('ov-v2'), Number(snap.totalHours.toFixed(1)).toString()),
      noteCell(p('ov-note'), OVERALL_TOTAL_HOURS_NOTE),
    ],
    [
      labelCell(p('cs-l1'), '粗分件量'),
      bodyValue(p('cs-v1'), String(snap.totalVolume)),
      labelCell(p('cs-l2'), '粗分环节工时/h'),
      bodyValue(
        p('cs-v2'),
        snap.coarseStageHours != null ? Number(snap.coarseStageHours.toFixed(1)).toString() : '',
        'default',
      ),
      noteCell(p('cs-note'), ''),
    ],
    [
      labelCell(p('fs-l1'), '细分件量'),
      bodyValue(p('fs-v1'), String(snap.totalVolume)),
      labelCell(p('fs-l2'), '细分环节工时/h'),
      bodyValue(p('fs-v2'), ''),
      noteCell(p('fs-note'), ''),
    ],
    [
      labelCell(p('cost-l1'), '总成本'),
      bodyValue(
        p('cost-v1'),
        formatTotalLaborCostDisplay(snap.totalLaborCost),
        snap.totalLaborCost != null ? 'red' : 'default',
      ),
      labelCell(p('cost-l2'), '每票成本/$'),
      bodyValue(
        p('cost-v2'),
        formatCostPerTicketDisplay(snap.costPerTicket),
        snap.costPerTicket != null ? 'red' : 'default',
      ),
      noteCell(p('cost-note'), OVERALL_COST_PER_TICKET_NOTE),
    ],
    [],
    [cell(p('sec-eff'), '效率达成情况', { colSpan: 7, variant: 'section' })],
    [
      cell(p('eh-1'), '目标类型', { variant: 'header' }),
      cell(p('eh-2'), '目标效率（件/小时）', { variant: 'header' }),
      cell(p('eh-3'), '实际计划效率（件/小时）', { variant: 'header' }),
      cell(p('eh-4'), '达成比例', { variant: 'header' }),
      cell(p('eh-5'), '问题反馈(菜鸟件占比越高, 效率越好)', { colSpan: 3, variant: 'header' }),
    ],
  ]

  const effRows: [string, string, string, string, number | null, string][] = [
    [
      '粗分目标效率',
      String(COARSE_SORT_TARGET_EFFICIENCY),
      formatEfficiency(snap.avgSortingEfficiency),
      formatPercent(snap.coarseAchievementRatio),
      snap.coarseAchievementRatio,
      '',
    ],
    ['细分目标效率', '/', '/', '/', null, ''],
    [
      '总体人效',
      String(OVERALL_TARGET_EFFICIENCY),
      snap.overallEfficiency != null && Number.isFinite(snap.overallEfficiency)
        ? Number(snap.overallEfficiency.toFixed(0)).toString()
        : '',
      formatPercent(snap.overallAchievementRatio),
      snap.overallAchievementRatio,
      formatOverallCainiaoFeedback(snap.overallCainiaoShare),
    ],
  ]

  for (const [idx, [type, target, actual, ratioText, achievementRatio, feedback]] of effRows.entries()) {
    const ratioTone: PlanPreviewCellTone =
      achievementRatio != null && Number.isFinite(achievementRatio)
        ? achievementRatio < 1
          ? 'red'
          : 'green'
        : 'default'
    const feedbackTone = type === '总体人效' && feedback ? 'red' : 'default'
    mainRows.push([
      labelCell(p(`eff-${idx}-t`), type),
      bodyValue(p(`eff-${idx}-target`), target),
      bodyValue(p(`eff-${idx}-actual`), actual),
      ratioValue(p(`eff-${idx}-ratio`), ratioText, ratioTone),
      cell(p(`eff-${idx}-fb`), feedback, {
        colSpan: 3,
        editable: true,
        tone: feedbackTone,
        align: 'left',
        variant: 'body',
        emphasis: 'feedback',
      }),
    ])
  }

  mainRows.push(
    [],
    [cell(p('sec-labor'), '工时结构', { colSpan: 7, variant: 'section' })],
  )

  const laborRows: [string, string][] = [
    ['直接作业人员工时', String(snap.level1SorterCount)],
    ['间接作业人员工时', ''],
    ['管理人员作业工时', ''],
    ['直接作业人员工时占比', formatPercent(snap.directStaffRatio)],
  ]
  for (const [idx, [label, value]] of laborRows.entries()) {
    mainRows.push([
      labelCell(p(`lb-${idx}-l`), label, 3),
      bodyValue(p(`lb-${idx}-v`), value, 'default'),
    ])
  }

  mainRows.push(
    [],
    [cell(p('sec-mgr'), '管理人员出勤说明', { colSpan: 7, variant: 'section' })],
    [
      cell(p('mgr-h1'), '人数', { variant: 'header' }),
      bodyValue(p('mgr-v1'), '1'),
      cell(p('mgr-h2'), '姓名', { variant: 'header' }),
      bodyValue(p('mgr-v2'), 'Tong'),
    ],
  )

  const attendanceRows: PlanPreviewCell[][] = [
    [cell(p('sec-att'), '作业人员出勤说明', { colSpan: 10, variant: 'section' })],
    [
      cell(p('ah-1'), '岗位', { variant: 'header' }),
      cell(p('ah-2'), '出勤人数', { variant: 'header' }),
      cell(p('ah-3'), '计划上班时间', { variant: 'header' }),
      cell(p('ah-4'), '计划下班时间', { variant: 'header' }),
      cell(p('ah-5'), '预计出勤工时', { variant: 'header' }),
      cell(p('ah-6'), '工作安排备注', { colSpan: 3, variant: 'header' }),
      cell(p('ah-7'), '备注', { colSpan: 2, variant: 'header' }),
    ],
  ]

  for (const [idx, op] of operatorRows.entries()) {
    attendanceRows.push([
      cell(p(`op-${idx}-pos`), op.position, { variant: 'body', emphasis: 'label' }),
      bodyValue(p(`op-${idx}-count`), String(op.count)),
      bodyValue(p(`op-${idx}-start`), op.plannedStart),
      bodyValue(p(`op-${idx}-end`), op.plannedEnd),
      bodyValue(p(`op-${idx}-hours`), op.expectedHours === '' ? '' : String(op.expectedHours)),
      cell(p(`op-${idx}-remark`), op.remark, { colSpan: 3, editable: true, align: 'left', variant: 'body' }),
      cell(p(`op-${idx}-note`), op.note, {
        colSpan: 2,
        editable: true,
        align: 'left',
        variant: 'body',
        tone: op.note ? 'red' : 'default',
      }),
    ])
  }

  return [
    { columns: 7, rows: expandMainRows(mainRows) },
    { columns: 10, rows: attendanceRows },
  ]
}

function expandOverallPairRow(row: PlanPreviewCell[]): PlanPreviewCell[] {
  return [row[0]!, row[1]!, row[2]!, row[3]!, { ...row[4]!, colSpan: 3 }]
}

function expandMainRows(rows: PlanPreviewCell[][]): PlanPreviewCell[][] {
  return rows.map((row) => {
    if (row.length === 5 && row[0]?.variant !== 'header') {
      return expandOverallPairRow(row)
    }
    if (row.length === 4 && row[0]?.variant !== 'header') {
      return expandPairRow(row)
    }
    if (row.length === 2 && row[0]?.colSpan === 3) {
      return [row[0]!, { ...row[1]!, colSpan: 4 }]
    }
    if (row.length === 4 && row[0]?.variant === 'header' && row[2]?.variant === 'header') {
      return [row[0]!, row[1]!, row[2]!, { ...row[3]!, colSpan: 4 }]
    }
    return row
  })
}

/** 将 4 格「左标签|左值|右标签|右值」行展开为 7 列（值区 colSpan 2 / 3） */
function expandPairRow(row: PlanPreviewCell[]): PlanPreviewCell[] {
  if (row.length !== 4) return row
  return [
    row[0]!,
    { ...row[1]!, colSpan: 2 },
    row[2]!,
    { ...row[3]!, colSpan: 3 },
  ]
}

export function buildAttendanceSchedulingPlanPreview({
  attendanceResult,
  attendanceRows,
  scannerResult,
  planDate,
  warehouseTitle = '阿德莱德仓库',
  dailyLaborCostByDate,
}: {
  attendanceResult: AttendanceEfficiencyResult
  attendanceRows: ParsedAttendanceRow[]
  scannerResult: ScannerEfficiencyResult | null
  planDate: string
  warehouseTitle?: string
  dailyLaborCostByDate?: Record<string, DailyLaborCostMetrics>
}): AttendanceSchedulingPlanPreview {
  const snap = buildAttendanceSchedulingPlanSnapshot({
    attendanceResult,
    scannerResult,
    planDate,
    warehouseTitle,
    dailyLaborCostByDate,
  })
  const operatorRows = resolveOperatorAttendancePlanRows({
    attendanceRows,
    attendanceResult,
    scannerResult,
    planDate,
  })
  return {
    planDate,
    title: snap.sheetTitle,
    tables: buildTablesFromSnapshot(planDate, snap, operatorRows),
  }
}

export function buildAllAttendanceSchedulingPlanPreviews({
  attendanceResult,
  attendanceRows,
  scannerResult,
  warehouseTitle = '阿德莱德仓库',
  dailyLaborCostByDate,
}: {
  attendanceResult: AttendanceEfficiencyResult
  attendanceRows: ParsedAttendanceRow[]
  scannerResult: ScannerEfficiencyResult | null
  warehouseTitle?: string
  dailyLaborCostByDate?: Record<string, DailyLaborCostMetrics>
}): AttendanceSchedulingPlanPreview[] {
  return resolveOpenPlanDates(attendanceResult).map((planDate) =>
    buildAttendanceSchedulingPlanPreview({
      attendanceResult,
      attendanceRows,
      scannerResult,
      planDate,
      warehouseTitle,
      dailyLaborCostByDate,
    }),
  )
}

export function flattenPreviewCellTexts(preview: AttendanceSchedulingPlanPreview): Record<string, string> {
  const out: Record<string, string> = {}
  for (const table of preview.tables) {
    for (const row of table.rows) {
      for (const c of row) {
        if (c.key) out[c.key] = c.text
      }
    }
  }
  return out
}
