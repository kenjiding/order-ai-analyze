import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import type { AttendanceEfficiencyResult, ParsedAttendanceRow, ScannerEfficiencyResult } from './aggregates'
import type { DailyLaborCostMetrics } from '../../payroll/laborCostFromAttendance'
import { resolveLevel1SorterCountForDate } from './attendanceSchedulingPlanMetrics'
import { resolveCoarseStageHours } from './coarseStageHours'
import { resolveOperatorAttendancePlanRows } from './attendanceSchedulingPlanOperators'
import { formatCainiaoSharePercent } from './cainiaoWaybill'
import { sortingEfficiencyForDate } from './sortingLookup'

/** 粗分目标效率（件/小时） */
export const COARSE_SORT_TARGET_EFFICIENCY = 470

/** 总体人效目标效率（件/小时） */
export const OVERALL_TARGET_EFFICIENCY = 140

/** 主表区域列宽（标题、总体情况、效率达成等），第 3 列略宽以容纳「实际计划效率（件/小时）」 */
export const BASE_SHEET_COLUMN_WIDTHS = [14, 16, 19, 16, 14, 16, 14] as const

/** 仅「作业人员出勤说明」向右扩展的附加列宽 */
export const ATTENDANCE_EXTRA_COLUMN_WIDTHS = [24, 24, 22] as const

const ATTENDANCE_LAST_COL =
  BASE_SHEET_COLUMN_WIDTHS.length + ATTENDANCE_EXTRA_COLUMN_WIDTHS.length

const REMARK_COL_START = 6
const REMARK_COL_END = 8
const NOTE_COL_START = 9
const NOTE_COL_END = ATTENDANCE_LAST_COL

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9D9D9' },
}

const VALUE_FONT_RED: Partial<ExcelJS.Font> = { color: { argb: 'FFFF0000' } }

const VALUE_FONT_GREEN: Partial<ExcelJS.Font> = { color: { argb: 'FF008000' } }

const WHITE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFFFF' },
}

function applyWhiteFill(cell: ExcelJS.Cell) {
  cell.fill = WHITE_FILL
}

function applyBorder(cell: ExcelJS.Cell) {
  cell.border = BORDER_THIN
}

function styleSectionTitle(cell: ExcelJS.Cell, value: string) {
  cell.value = value
  cell.font = { bold: true, size: 11 }
  cell.fill = HEADER_FILL
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
  applyBorder(cell)
}

function styleHeaderCell(cell: ExcelJS.Cell, value: string) {
  cell.value = value
  cell.font = { bold: true, size: 10 }
  cell.fill = HEADER_FILL
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  applyBorder(cell)
}

function styleLabelCell(cell: ExcelJS.Cell, value: string, redValue = false) {
  cell.value = value
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  if (redValue) cell.font = { ...VALUE_FONT_RED }
  applyWhiteFill(cell)
  applyBorder(cell)
}

function styleValueCell(cell: ExcelJS.Cell, value: string | number, redValue = false) {
  cell.value = value
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
  if (redValue) cell.font = { ...VALUE_FONT_RED }
  applyWhiteFill(cell)
  applyBorder(cell)
}

function styleAchievementRatioCell(cell: ExcelJS.Cell, ratioText: string, ratioValue: number | null) {
  cell.value = ratioText
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
  if (ratioValue != null && Number.isFinite(ratioValue)) {
    if (ratioValue < 1) cell.font = { ...VALUE_FONT_RED }
    else cell.font = { ...VALUE_FONT_GREEN }
  }
  applyWhiteFill(cell)
  applyBorder(cell)
}

function styleAttendanceTextCell(cell: ExcelJS.Cell, value: string, redValue = false) {
  cell.value = value
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  if (redValue) cell.font = { ...VALUE_FONT_RED }
  applyWhiteFill(cell)
  applyBorder(cell)
}

function formatPlanDateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (!m) return isoDate
  return `${Number(m[2])}-${Number(m[3])}`
}

function formatPercent(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return ''
  return `${Math.round(ratio * 100)}%`
}

function formatPlanHoursValue(value: number | null | undefined): number | '' {
  if (value == null || !Number.isFinite(value)) return ''
  return Number(value.toFixed(1))
}

/** 出勤排班「总体情况-总成本」展示（如 $1234.56） */
export function formatTotalLaborCostDisplay(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return `$${Number(value.toFixed(2))}`
}

/** 出勤排班「总体情况-每票成本」展示（如 1.23/票） */
export function formatCostPerTicketDisplay(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return `${Number(value.toFixed(2))}/票`
}

function formatEfficiency(value: number | ''): string | number {
  if (value === '') return ''
  return value
}

function formatOverallCainiaoFeedback(share: number | null | undefined): string {
  const percent = formatCainiaoSharePercent(share)
  return percent === '—' ? '菜鸟件占比—' : `菜鸟件占比${percent}`
}

export type AttendanceSchedulingPlanSnapshot = {
  sheetTitle: string
  totalVolume: number
  totalHours: number
  coarseStageHours: number | null
  level1SorterCount: number
  avgSortingEfficiency: number | ''
  coarseAchievementRatio: number | null
  overallEfficiency: number | null
  overallAchievementRatio: number | null
  overallCainiaoShare: number | null
  directStaffRatio: number | null
  operatorHeadcount: number
  totalLaborCost: number | null
  costPerTicket: number | null
}

export function resolveOpenPlanDates(attendanceResult: AttendanceEfficiencyResult): string[] {
  return attendanceResult.dailyRows
    .filter((row) => row.isOpenDay)
    .map((row) => row.date)
    .sort((a, b) => a.localeCompare(b))
}

function resolveExportFileName(warehouseTitle: string, openPlanDates: string[]): string {
  if (openPlanDates.length === 1) {
    return `${warehouseTitle} 出勤及排班计划 (${formatPlanDateLabel(openPlanDates[0]!)}).xlsx`
  }
  const first = formatPlanDateLabel(openPlanDates[0]!)
  const last = formatPlanDateLabel(openPlanDates[openPlanDates.length - 1]!)
  return `${warehouseTitle} 出勤及排班计划 (${first}~${last}).xlsx`
}

function resolveWorksheetName(planDate: string, usedNames: Set<string>): string {
  let base = `出勤及排班计划 (${formatPlanDateLabel(planDate)})`
  if (base.length > 31) base = formatPlanDateLabel(planDate)
  let name = base
  let suffix = 2
  while (usedNames.has(name)) {
    const tail = ` (${suffix})`
    name = `${base.slice(0, Math.max(1, 31 - tail.length))}${tail}`
    suffix += 1
  }
  usedNames.add(name)
  return name
}

export function buildAttendanceSchedulingPlanSnapshot({
  attendanceResult,
  scannerResult,
  planDate,
  warehouseTitle = '阿德莱德仓库',
  dailyLaborCostByDate,
}: {
  attendanceResult: AttendanceEfficiencyResult
  scannerResult: ScannerEfficiencyResult | null
  planDate: string
  warehouseTitle?: string
  dailyLaborCostByDate?: Record<string, DailyLaborCostMetrics>
}): AttendanceSchedulingPlanSnapshot {
  const dayRow = attendanceResult.dailyRows.find((row) => row.date === planDate)
  if (!dayRow) {
    throw new Error(`Missing attendance day row for plan date: ${planDate}`)
  }

  const totalVolume = dayRow.volume
  const totalHours = dayRow.totalHours
  const level1SorterCount = resolveLevel1SorterCountForDate(scannerResult, attendanceResult, planDate)
  const avgSortingEfficiency = sortingEfficiencyForDate(scannerResult, planDate)
  const coarseAchievementRatio =
    typeof avgSortingEfficiency === 'number' && avgSortingEfficiency > 0
      ? avgSortingEfficiency / COARSE_SORT_TARGET_EFFICIENCY
      : null
  const overallEfficiency = dayRow.dayEfficiency
  const overallAchievementRatio =
    overallEfficiency != null && Number.isFinite(overallEfficiency) && overallEfficiency > 0
      ? overallEfficiency / OVERALL_TARGET_EFFICIENCY
      : null
  const operatorHeadcount = 2 + level1SorterCount
  const directStaffRatio =
    operatorHeadcount > 0 ? level1SorterCount / operatorHeadcount : null

  const overallCainiaoShare = dayRow.volume > 0 ? dayRow.cainiaoShare : null
  const coarseStageHours = resolveCoarseStageHours(scannerResult, planDate)
  const laborMetrics = dailyLaborCostByDate?.[planDate]
  const totalLaborCost = laborMetrics?.totalLaborCost ?? null
  const costPerTicket = laborMetrics?.costPerTicket ?? null
  const planDateLabel = formatPlanDateLabel(planDate)
  const sheetTitle = `${warehouseTitle} 出勤及排班计划 (${planDateLabel})`

  return {
    sheetTitle,
    totalVolume,
    totalHours,
    coarseStageHours,
    level1SorterCount,
    avgSortingEfficiency,
    coarseAchievementRatio,
    overallEfficiency,
    overallAchievementRatio,
    overallCainiaoShare,
    directStaffRatio,
    operatorHeadcount,
    totalLaborCost,
    costPerTicket,
  }
}

function appendAttendanceSchedulingPlanSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  snap: AttendanceSchedulingPlanSnapshot,
  operatorRows: ReturnType<typeof resolveOperatorAttendancePlanRows>,
) {
  const sheet = workbook.addWorksheet(sheetName, {
    properties: { defaultRowHeight: 20 },
    views: [{ showGridLines: false }],
  })

  sheet.columns = [...BASE_SHEET_COLUMN_WIDTHS, ...ATTENDANCE_EXTRA_COLUMN_WIDTHS].map((width) => ({
    width,
  }))

  let row = 1
  sheet.mergeCells(row, 1, row, 7)
  const titleCell = sheet.getCell(row, 1)
  titleCell.value = snap.sheetTitle
  titleCell.font = { bold: true, size: 14 }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  applyWhiteFill(titleCell)
  sheet.getRow(row).height = 28
  row += 2

  // —— 总体情况 ——
  sheet.mergeCells(row, 1, row, 7)
  styleSectionTitle(sheet.getCell(row, 1), '总体情况')
  row += 1

  const overallPairs: [string, string | number, string, string | number][] = [
    ['预计入站件量', snap.totalVolume, '预计总工时/h', formatPlanHoursValue(snap.totalHours)],
    [
      '粗分件量',
      snap.totalVolume,
      '粗分环节工时/h',
      formatPlanHoursValue(snap.coarseStageHours),
    ],
    ['细分件量', snap.totalVolume, '细分环节工时/h', ''],
    [
      '总成本',
      formatTotalLaborCostDisplay(snap.totalLaborCost),
      '每票成本',
      formatCostPerTicketDisplay(snap.costPerTicket),
    ],
  ]
  for (const [l1, v1, l2, v2] of overallPairs) {
    styleLabelCell(sheet.getCell(row, 1), l1)
    styleValueCell(sheet.getCell(row, 2), v1, v1 !== '')
    sheet.mergeCells(row, 2, row, 3)
    styleLabelCell(sheet.getCell(row, 4), l2)
    styleValueCell(sheet.getCell(row, 5), v2, Boolean(v2))
    sheet.mergeCells(row, 5, row, 7)
    row += 1
  }
  row += 1
  sheet.mergeCells(row, 1, row, 7)
  styleSectionTitle(sheet.getCell(row, 1), '效率达成情况')
  row += 1

  const effHeaders = ['目标类型', '目标效率（件/小时）', '实际计划效率（件/小时）', '达成比例', '问题反馈']
  effHeaders.forEach((h, i) => {
    const col = i + 1
    styleHeaderCell(sheet.getCell(row, col), h)
    if (i === effHeaders.length - 1) sheet.mergeCells(row, col, row, 7)
  })
  row += 1

  const effRows: [string, string | number, string | number, string, number | null, string][] = [
    [
      '粗分目标效率',
      COARSE_SORT_TARGET_EFFICIENCY,
      formatEfficiency(snap.avgSortingEfficiency),
      formatPercent(snap.coarseAchievementRatio),
      snap.coarseAchievementRatio,
      '',
    ],
    ['细分目标效率', '/', '/', '/', null, ''],
    [
      '总体人效',
      OVERALL_TARGET_EFFICIENCY,
      snap.overallEfficiency != null && Number.isFinite(snap.overallEfficiency)
        ? Number(snap.overallEfficiency.toFixed(0))
        : '',
      formatPercent(snap.overallAchievementRatio),
      snap.overallAchievementRatio,
      formatOverallCainiaoFeedback(snap.overallCainiaoShare),
    ],
  ]
  for (const [type, target, actual, ratioText, ratioValue, feedback] of effRows) {
    styleLabelCell(sheet.getCell(row, 1), type)
    styleValueCell(sheet.getCell(row, 2), target)
    styleValueCell(sheet.getCell(row, 3), actual)
    styleAchievementRatioCell(sheet.getCell(row, 4), ratioText, ratioValue)
    const feedbackCell = sheet.getCell(row, 5)
    const feedbackRed = type === '总体人效' && Boolean(feedback)
    if (feedbackRed) {
      styleValueCell(feedbackCell, feedback, true)
    } else {
      feedbackCell.value = feedback
      feedbackCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
      applyWhiteFill(feedbackCell)
      applyBorder(feedbackCell)
    }
    sheet.mergeCells(row, 5, row, 7)
    row += 1
  }
  row += 1

  // —— 工时结构（左栏） ——
  const laborRows: [string, string | number][] = [
    ['直接作业人员工时', snap.level1SorterCount],
    ['间接作业人员工时', ''],
    ['管理人员作业工时', ''],
    ['直接作业人员工时占比', formatPercent(snap.directStaffRatio)],
  ]
  for (const [label, value] of laborRows) {
    styleLabelCell(sheet.getCell(row, 1), label)
    sheet.mergeCells(row, 1, row, 3)
    styleValueCell(sheet.getCell(row, 4), value)
    sheet.mergeCells(row, 4, row, 7)
    row += 1
  }
  row += 1

  // —— 作业人员出勤说明 ——（向右扩展 8–10 列，仅本区块加宽）
  sheet.mergeCells(row, 1, row, ATTENDANCE_LAST_COL)
  styleSectionTitle(sheet.getCell(row, 1), '作业人员出勤说明')
  row += 1

  const attendanceHeaders: { label: string; col: number; colEnd?: number }[] = [
    { label: '岗位', col: 1 },
    { label: '出勤人数', col: 2 },
    { label: '计划上班时间', col: 3 },
    { label: '计划下班时间', col: 4 },
    { label: '预计出勤工时', col: 5 },
    { label: '工作安排备注', col: REMARK_COL_START, colEnd: REMARK_COL_END },
    { label: '备注', col: NOTE_COL_START, colEnd: NOTE_COL_END },
  ]
  for (const header of attendanceHeaders) {
    styleHeaderCell(sheet.getCell(row, header.col), header.label)
    if (header.colEnd && header.colEnd > header.col) {
      sheet.mergeCells(row, header.col, row, header.colEnd)
    }
  }
  sheet.getRow(row).height = 28
  row += 1

  for (const op of operatorRows) {
    styleLabelCell(sheet.getCell(row, 1), op.position)
    styleValueCell(sheet.getCell(row, 2), op.count)
    styleValueCell(sheet.getCell(row, 3), op.plannedStart)
    styleValueCell(sheet.getCell(row, 4), op.plannedEnd)
    styleValueCell(sheet.getCell(row, 5), op.expectedHours)
    styleAttendanceTextCell(sheet.getCell(row, REMARK_COL_START), op.remark)
    sheet.mergeCells(row, REMARK_COL_START, row, REMARK_COL_END)
    styleAttendanceTextCell(sheet.getCell(row, NOTE_COL_START), op.note, Boolean(op.note))
    sheet.mergeCells(row, NOTE_COL_START, row, NOTE_COL_END)
    const rowHeight = op.remark || op.note ? 52 : 24
    sheet.getRow(row).height = Math.max(sheet.getRow(row).height ?? 20, rowHeight)
    row += 1
  }
  row += 1

  // —— 管理人员出勤说明 ——
  sheet.mergeCells(row, 1, row, 7)
  styleSectionTitle(sheet.getCell(row, 1), '管理人员出勤说明')
  row += 1

  styleHeaderCell(sheet.getCell(row, 1), '人数')
  styleValueCell(sheet.getCell(row, 2), 1)
  styleHeaderCell(sheet.getCell(row, 3), '姓名')
  styleValueCell(sheet.getCell(row, 4), 'Tong')
  sheet.mergeCells(row, 4, row, 7)
}

export async function exportAttendanceSchedulingPlanExcel({
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
}): Promise<{ exportedCount: number }> {
  const openPlanDates = resolveOpenPlanDates(attendanceResult)
  if (!openPlanDates.length) return { exportedCount: 0 }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = '仓库效率工作台'
  workbook.created = new Date()

  const usedSheetNames = new Set<string>()
  for (const planDate of openPlanDates) {
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
    appendAttendanceSchedulingPlanSheet(
      workbook,
      resolveWorksheetName(planDate, usedSheetNames),
      snap,
      operatorRows,
    )
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const fileName = resolveExportFileName(warehouseTitle, openPlanDates)
  saveAs(blob, fileName.replace(/[/\\?%*:|"<>]/g, '_'))
  return { exportedCount: openPlanDates.length }
}
