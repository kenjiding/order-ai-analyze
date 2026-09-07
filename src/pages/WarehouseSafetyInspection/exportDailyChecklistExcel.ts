import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { i18n } from '../../i18n'
import { getDailyChecklistTemplate, type DailyChecklistTemplateRow } from './dailyChecklistTemplate'
import { parseDataUrlForExcel } from './localEvidenceImage'
import type { DailyChecklistFormState, DailyChecklistRowState } from './types'

const NS = 'warehouseSafety'

function wt(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: NS, ...options })
}

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF2' },
}

const TITLE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F6F68' },
}

function applyBorder(cell: ExcelJS.Cell) {
  cell.border = BORDER_THIN
}

function styleHeaderCell(cell: ExcelJS.Cell, value: string) {
  cell.value = value
  cell.font = { bold: true, size: 11, color: { argb: 'FF1A1A1A' } }
  cell.fill = HEADER_FILL
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  applyBorder(cell)
}

function formatEvidenceText(row: DailyChecklistRowState): string {
  const parts: string[] = []
  if (row.result === 'no_risk') {
    if (row.evidenceNote.trim()) parts.push(row.evidenceNote.trim())
    return parts.join('\n')
  }
  if (row.rectificationMeasure.trim()) {
    parts.push(`${wt('evidence.measurePrefix')}${row.rectificationMeasure.trim()}`)
  }
  if (row.rectificationDueDate) {
    parts.push(`${wt('evidence.dueDatePrefix')}${row.rectificationDueDate}`)
  }
  return parts.join('\n')
}

function formatResultLabel(result: DailyChecklistRowState['result']): string {
  return result === 'risk' ? wt('result.risk') : wt('result.noRisk')
}

type MergeSpan = { start: number; end: number }

function buildMergeSpans(rows: DailyChecklistTemplateRow[], key: 'category' | 'item'): MergeSpan[] {
  const spans: MergeSpan[] = []
  let start = 0
  for (let i = 1; i <= rows.length; i += 1) {
    const prev = rows[i - 1]
    const cur = rows[i]
    if (!cur || prev[key] !== cur[key]) {
      if (i - 1 > start) spans.push({ start, end: i - 1 })
      start = i
    }
  }
  return spans
}

export type ExportValidationIssue = {
  serialNo?: number
  message: string
}

export function validateDailyChecklistForExport(
  form: DailyChecklistFormState,
): ExportValidationIssue[] {
  const issues: ExportValidationIssue[] = []
  const { meta } = form
  if (!meta.warehouseName.trim()) {
    issues.push({ message: wt('validation.warehouseRequired') })
  }
  if (!meta.inspectorName.trim()) {
    issues.push({ message: wt('validation.inspectorRequired') })
  }
  if (!meta.inspectionDate.trim()) {
    issues.push({ message: wt('validation.dateRequired') })
  }

  const template = getDailyChecklistTemplate(wt)
  for (const tpl of template) {
    const row = form.rows[tpl.serialNo]
    if (!row || row.result !== 'risk') continue
    if (!row.rectificationMeasure.trim()) {
      issues.push({ serialNo: tpl.serialNo, message: wt('validation.measureRequired', { serialNo: tpl.serialNo }) })
    }
    if (!row.rectificationDueDate.trim()) {
      issues.push({ serialNo: tpl.serialNo, message: wt('validation.dueDateRequired', { serialNo: tpl.serialNo }) })
    }
  }
  return issues
}

export async function exportDailyChecklistExcel(form: DailyChecklistFormState): Promise<void> {
  const template = getDailyChecklistTemplate(wt)
  const checklistTitle = wt('checklist.title')

  const workbook = new ExcelJS.Workbook()
  workbook.creator = wt('export.creator')
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(wt('export.sheetName'), {
    views: [{ state: 'frozen', ySplit: 3 }],
  })

  sheet.columns = [
    { width: 6 },
    { width: 16 },
    { width: 22 },
    { width: 38 },
    { width: 12 },
    { width: 36 },
  ]

  const titleRow = sheet.getRow(1)
  titleRow.height = 36
  sheet.mergeCells(1, 1, 1, 6)
  const titleCell = sheet.getCell(1, 1)
  titleCell.value = checklistTitle
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
  titleCell.fill = TITLE_FILL
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }

  const meta = form.meta
  const metaRow = sheet.getRow(2)
  metaRow.height = 22
  sheet.mergeCells(2, 1, 2, 2)
  sheet.mergeCells(2, 3, 2, 4)
  sheet.mergeCells(2, 5, 2, 6)
  const m1 = sheet.getCell(2, 1)
  m1.value = wt('export.metaWarehouse', { name: meta.warehouseName.trim() })
  m1.alignment = { vertical: 'middle', wrapText: true }
  applyBorder(m1)
  const m2 = sheet.getCell(2, 3)
  m2.value = wt('export.metaInspector', { name: meta.inspectorName.trim() })
  m2.alignment = { vertical: 'middle', wrapText: true }
  applyBorder(m2)
  const m3 = sheet.getCell(2, 5)
  m3.value = wt('export.metaDate', { date: meta.inspectionDate })
  m3.alignment = { vertical: 'middle', wrapText: true }
  applyBorder(m3)

  const headerRowIndex = 3
  const headers = [
    wt('export.headerSerialNo'),
    wt('export.headerCategory'),
    wt('export.headerItem'),
    wt('export.headerKeyPoint'),
    wt('export.headerResult'),
    wt('export.headerEvidence'),
  ]
  const headerRow = sheet.getRow(headerRowIndex)
  headerRow.height = 32
  headers.forEach((text, idx) => {
    styleHeaderCell(headerRow.getCell(idx + 1), text)
  })

  const dataStartRow = headerRowIndex + 1
  const categorySpans = buildMergeSpans(template, 'category')
  const itemSpans = buildMergeSpans(template, 'item')

  const imageJobs: { rowIndex: number; colIndex: number; dataUrl: string }[] = []

  template.forEach((tpl, idx) => {
    const excelRowIndex = dataStartRow + idx
    const rowState = form.rows[tpl.serialNo]
    const sheetRow = sheet.getRow(excelRowIndex)
    sheetRow.height = 42

    const serialCell = sheetRow.getCell(1)
    serialCell.value = tpl.serialNo
    serialCell.alignment = { horizontal: 'center', vertical: 'middle' }
    applyBorder(serialCell)

    const categoryCell = sheetRow.getCell(2)
    categoryCell.value = tpl.category
    categoryCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    applyBorder(categoryCell)

    const itemCell = sheetRow.getCell(3)
    itemCell.value = tpl.item
    itemCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    applyBorder(itemCell)

    const keyCell = sheetRow.getCell(4)
    keyCell.value = `${tpl.serialNo}. ${tpl.keyPoint}`
    keyCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    applyBorder(keyCell)

    const resultCell = sheetRow.getCell(5)
    resultCell.value = formatResultLabel(rowState.result)
    resultCell.alignment = { horizontal: 'center', vertical: 'middle' }
    resultCell.font = {
      bold: rowState.result === 'risk',
      color: { argb: rowState.result === 'risk' ? 'FFC00000' : 'FF006100' },
    }
    applyBorder(resultCell)

    const evidenceCell = sheetRow.getCell(6)
    const evidenceText = formatEvidenceText(rowState)
    if (evidenceText) {
      evidenceCell.value = evidenceText
    }
    evidenceCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    applyBorder(evidenceCell)

    if (rowState.evidenceImages.length > 0) {
      for (const img of rowState.evidenceImages) {
        imageJobs.push({ rowIndex: excelRowIndex - 1, colIndex: 5, dataUrl: img.dataUrl })
      }
    }
  })

  for (const span of categorySpans) {
    const startExcel = dataStartRow + span.start
    const endExcel = dataStartRow + span.end
    if (endExcel > startExcel) {
      sheet.mergeCells(startExcel, 2, endExcel, 2)
    }
  }
  for (const span of itemSpans) {
    const startExcel = dataStartRow + span.start
    const endExcel = dataStartRow + span.end
    if (endExcel > startExcel) {
      sheet.mergeCells(startExcel, 3, endExcel, 3)
    }
  }

  const rowImageOffset = new Map<number, number>()
  for (const job of imageJobs) {
    try {
      const { base64, extension } = parseDataUrlForExcel(job.dataUrl)
      const imageId = workbook.addImage({ base64, extension })
      const offset = rowImageOffset.get(job.rowIndex) ?? 0
      sheet.addImage(imageId, {
        tl: { col: job.colIndex + 0.15, row: job.rowIndex + 0.2 + offset * 0.75 },
        ext: { width: 88, height: 66 },
        editAs: 'oneCell',
      })
      rowImageOffset.set(job.rowIndex, offset + 1)
      const r = sheet.getRow(job.rowIndex + 1)
      r.height = Math.max(r.height ?? 42, 42 + (offset + 1) * 52)
    } catch {
      /* 单张图片失败不阻断整表导出 */
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const safeWarehouse =
    meta.warehouseName.trim().replace(/[/\\?%*:|"<>]/g, '_') || wt('export.unnamedWarehouse')
  const datePart = meta.inspectionDate.replace(/-/g, '')
  saveAs(
    blob,
    wt('export.fileName', {
      title: checklistTitle,
      warehouse: safeWarehouse,
      date: datePart,
    }),
  )
}
