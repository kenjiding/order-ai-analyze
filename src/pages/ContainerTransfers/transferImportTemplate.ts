/**
 * 流转记录批量导入模板（文案随当前 locale 生成）。
 */
import type ExcelJS from 'exceljs'
import dayjs from 'dayjs'
import { SELECTABLE_TRANSFER_KINDS } from '../../containerManagement/constants'
import type { ContainerAccount } from '../../containerManagement/types'
import { i18n } from '../../i18n'

const ns = 'container'

export const TRANSFER_IMPORT_MAX_ROWS = 200

const VALIDATION_ROWS = 500

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF2' },
}

function tt(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns, ...options })
}

export function transferImportSheetName(): string {
  return tt('importTemplate.sheetData')
}

export function transferImportRefSheetName(): string {
  return tt('importTemplate.sheetRef')
}

export function transferImportGuideSheetName(): string {
  return tt('importTemplate.sheetGuide')
}

export function transferImportHeaders(): string[] {
  return [
    tt('importTemplate.headerDate'),
    tt('importTemplate.headerKind'),
    tt('importTemplate.headerFrom'),
    tt('importTemplate.headerTo'),
    tt('importTemplate.headerBigBasketQty'),
    tt('importTemplate.headerSilverBoxQty'),
    tt('importTemplate.headerNote'),
  ]
}

async function buildWorkbook(
  fromAccounts: ContainerAccount[],
  toAccounts: ContainerAccount[],
): Promise<ExcelJS.Workbook> {
  const { default: ExcelJSModule } = await import('exceljs')
  const workbook = new ExcelJSModule.Workbook()
  workbook.creator = tt('importTemplate.creator')
  workbook.created = new Date()

  const sheetName = transferImportSheetName()
  const refSheetName = transferImportRefSheetName()
  const guideSheetName = transferImportGuideSheetName()
  const headers = transferImportHeaders()

  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = [{ width: 14 }, { width: 12 }, { width: 22 }, { width: 22 }, { width: 12 }, { width: 12 }, { width: 28 }]

  const headerRow = sheet.getRow(1)
  headers.forEach((title, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = title
    cell.font = { bold: true, size: 11, color: { argb: 'FF1A1A1A' } }
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  headerRow.commit()

  const refSheet = workbook.addWorksheet(refSheetName)
  refSheet.columns = [{ width: 24 }, { width: 24 }]
  const byName = (list: ContainerAccount[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name, i18n.language.startsWith('zh') ? 'zh-CN' : 'en'))
  const sortedFrom = byName(fromAccounts)
  const sortedTo = byName(toAccounts)
  ;(
    [
      [1, tt('importTemplate.refFromTitle'), sortedFrom],
      [2, tt('importTemplate.refToTitle'), sortedTo],
    ] as const
  ).forEach(([column, title, list]) => {
    const titleCell = refSheet.getCell(1, column)
    titleCell.value = title
    titleCell.font = { bold: true }
    titleCell.fill = HEADER_FILL
    list.forEach((account, index) => {
      refSheet.getCell(index + 2, column).value = account.name
    })
  })

  const kindList = SELECTABLE_TRANSFER_KINDS.map((kind) => tt(`transferKind.${kind}`)).join(',')
  const rangeOf = (columnLetter: string, size: number) =>
    size > 0 ? `=${refSheetName}!$${columnLetter}$2:$${columnLetter}$${size + 1}` : ''
  const fromRange = rangeOf('A', sortedFrom.length)
  const toRange = rangeOf('B', sortedTo.length)

  for (let row = 2; row <= VALIDATION_ROWS + 1; row += 1) {
    sheet.getCell(row, 1).numFmt = 'yyyy-mm-dd'
    sheet.getCell(row, 5).numFmt = '0'
    sheet.getCell(row, 6).numFmt = '0'
    sheet.getCell(row, 2).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${kindList}"`],
      showErrorMessage: true,
      errorTitle: tt('importTemplate.validationErrorTitle'),
      error: tt('importTemplate.validationErrorKind'),
    }
    for (const [column, range] of [
      [3, fromRange],
      [4, toRange],
    ] as const) {
      if (!range) continue
      sheet.getCell(row, column).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [range],
        showErrorMessage: false,
      }
    }
  }

  const guide = workbook.addWorksheet(guideSheetName)
  guide.columns = [{ width: 100 }]
  const lines = [
    tt('importTemplate.guideLine1', { dataSheet: sheetName, refSheet: refSheetName }),
    tt('importTemplate.guideLine2'),
    tt('importTemplate.guideLine3'),
    tt('importTemplate.guideLine4'),
    tt('importTemplate.guideLine5', { refSheet: refSheetName }),
    tt('importTemplate.guideLine6'),
    tt('importTemplate.guideLine7'),
    tt('importTemplate.guideLine8'),
    tt('importTemplate.guideLine9'),
    tt('importTemplate.guideLine10', { max: TRANSFER_IMPORT_MAX_ROWS }),
    tt('importTemplate.guideLine11'),
    '',
    tt('importTemplate.guideExample'),
    headers.join(' | '),
    tt('importTemplate.guideExampleRow1'),
    tt('importTemplate.guideExampleRow2'),
  ]
  lines.forEach((text, index) => {
    guide.getCell(index + 1, 1).value = text
  })
  guide.getCell(1, 1).font = { bold: true }

  return workbook
}

export async function buildTransferImportTemplateBuffer(
  fromAccounts: ContainerAccount[],
  toAccounts: ContainerAccount[],
): Promise<ArrayBuffer> {
  const workbook = await buildWorkbook(fromAccounts, toAccounts)
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer
}

export async function downloadTransferImportTemplate(
  fromAccounts: ContainerAccount[],
  toAccounts: ContainerAccount[],
): Promise<void> {
  const buffer = await buildTransferImportTemplateBuffer(fromAccounts, toAccounts)
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocumentml.sheet',
  })
  const { saveAs } = await import('file-saver')
  saveAs(blob, tt('importTemplate.filename', { date: dayjs().format('YYYYMMDD') }))
}
