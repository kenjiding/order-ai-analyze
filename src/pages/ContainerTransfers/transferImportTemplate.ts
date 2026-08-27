/**
 * 流转记录批量导入模板。
 *
 * 站点名手打极易对不上后端的账户 id，所以「业务类型 / 转出方 / 接收方」三列用 Excel 原生
 * 数据验证做成下拉，取值写在单独的「站点账户」表里再跨表引用 —— 站点名可能含逗号，
 * 内联列表（"A,B,C"）会被 Excel 拆错，只有引用区域是安全的。
 */
import type ExcelJS from 'exceljs'
import dayjs from 'dayjs'
import { SELECTABLE_TRANSFER_KINDS, transferKindLabel } from '../../containerManagement/constants'
import type { ContainerAccount } from '../../containerManagement/types'

/** 数据行 sheet 名，解析时优先按它取表 */
export const TRANSFER_IMPORT_SHEET = '流转记录'
/** 下拉取值 sheet 名 */
export const TRANSFER_IMPORT_REF_SHEET = '站点账户'
/** 说明 sheet 名 */
export const TRANSFER_IMPORT_GUIDE_SHEET = '填写说明'
/** 与后端 MAX_TRANSFER_IMPORT 对齐 */
export const TRANSFER_IMPORT_MAX_ROWS = 200

export const TRANSFER_IMPORT_HEADERS = [
  '日期',
  '业务类型',
  '转出方',
  '接收方',
  '大篮筐数量',
  '银框数量',
  '备注',
] as const

/** 下拉与取值区域覆盖的行数，留足余量（远大于 200 行上限） */
const VALIDATION_ROWS = 500

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF2' },
}

/** exceljs 只在点「下载模板」时才用得上，动态加载避免拖累页面首包 */
async function buildWorkbook(
  ownAccounts: ContainerAccount[],
  counterparties: ContainerAccount[],
): Promise<ExcelJS.Workbook> {
  const { default: ExcelJSModule } = await import('exceljs')
  const workbook = new ExcelJSModule.Workbook()
  workbook.creator = '容器管理'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(TRANSFER_IMPORT_SHEET)
  sheet.columns = [
    { width: 14 },
    { width: 12 },
    { width: 22 },
    { width: 22 },
    { width: 12 },
    { width: 12 },
    { width: 28 },
  ]

  const headerRow = sheet.getRow(1)
  TRANSFER_IMPORT_HEADERS.forEach((title, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = title
    cell.font = { bold: true, size: 11, color: { argb: 'FF1A1A1A' } }
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  headerRow.commit()

  // 取值表：A 列转出方、C 列接收方（隔开一列，避免用户误以为是一一对应的两列）
  const refSheet = workbook.addWorksheet(TRANSFER_IMPORT_REF_SHEET)
  refSheet.columns = [{ width: 24 }, { width: 4 }, { width: 24 }]
  refSheet.getCell('A1').value = '可选转出方'
  refSheet.getCell('C1').value = '可选接收方'
  for (const cell of [refSheet.getCell('A1'), refSheet.getCell('C1')]) {
    cell.font = { bold: true }
    cell.fill = HEADER_FILL
  }
  ownAccounts.forEach((account, index) => {
    refSheet.getCell(index + 2, 1).value = account.name
  })
  counterparties.forEach((account, index) => {
    refSheet.getCell(index + 2, 3).value = account.name
  })

  const kindList = SELECTABLE_TRANSFER_KINDS.map((kind) => transferKindLabel[kind]).join(',')
  for (let row = 2; row <= VALIDATION_ROWS + 1; row += 1) {
    sheet.getCell(row, 1).numFmt = 'yyyy-mm-dd'
    sheet.getCell(row, 5).numFmt = '0'
    sheet.getCell(row, 6).numFmt = '0'
    sheet.getCell(row, 2).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${kindList}"`],
      showErrorMessage: true,
      errorTitle: '取值不合法',
      error: '请从下拉列表中选择',
    }
    sheet.getCell(row, 3).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`=${TRANSFER_IMPORT_REF_SHEET}!$A$2:$A$${VALIDATION_ROWS + 1}`],
      showErrorMessage: true,
      errorTitle: '取值不合法',
      error: '转出方必须从下拉列表中选择',
    }
    sheet.getCell(row, 4).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`=${TRANSFER_IMPORT_REF_SHEET}!$C$2:$C$${VALIDATION_ROWS + 1}`],
      showErrorMessage: true,
      errorTitle: '取值不合法',
      error: '接收方必须从下拉列表中选择',
    }
  }

  // 示例写在说明表而不是数据表，否则会被当成一条真实记录解析进去
  const guide = workbook.addWorksheet(TRANSFER_IMPORT_GUIDE_SHEET)
  guide.columns = [{ width: 100 }]
  const lines = [
    `请只在「${TRANSFER_IMPORT_SHEET}」表里填写数据，本表与「${TRANSFER_IMPORT_REF_SHEET}」表不要改动。`,
    '一行 = 一条流转记录。同一条记录同时含大篮筐和银框时，把两个数量填在同一行的两列里。',
    '「大篮筐数量」「银框数量」至少填一个；留空表示这条记录不含该品类；填了必须是大于 0 的整数。',
    '「业务类型」「转出方」「接收方」必须点单元格右侧的下拉箭头选择，手打的站点名对不上系统账户会导入失败。',
    '「日期」格式 YYYY-MM-DD，例如 2026-08-27；留空则按当天算。',
    '「备注」可填车牌、运单号等，最长 2000 字。',
    `单次最多导入 ${TRANSFER_IMPORT_MAX_ROWS} 行；整批一个事务，任何一行不合法都不会写入。`,
    '批量导入不会发送飞书通知，导入后请另行告知接收方前来确认。',
    '',
    '示例：',
    `${TRANSFER_IMPORT_HEADERS.join(' | ')}`,
    '2026-08-27 | 借出 | A仓 | 清关行B | 120 | 30 | 车牌粤B123',
    '2026-08-27 | 归还 | A仓 | 客户C |  | 30 | ',
  ]
  lines.forEach((text, index) => {
    guide.getCell(index + 1, 1).value = text
  })
  guide.getCell(1, 1).font = { bold: true }

  return workbook
}

/** 导出给测试/校验用：拿到 buffer 而不落盘 */
export async function buildTransferImportTemplateBuffer(
  ownAccounts: ContainerAccount[],
  counterparties: ContainerAccount[],
): Promise<ArrayBuffer> {
  const workbook = await buildWorkbook(ownAccounts, counterparties)
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer
}

export async function downloadTransferImportTemplate(
  ownAccounts: ContainerAccount[],
  counterparties: ContainerAccount[],
): Promise<void> {
  const buffer = await buildTransferImportTemplateBuffer(ownAccounts, counterparties)
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const { saveAs } = await import('file-saver')
  saveAs(blob, `容器流转导入模板-${dayjs().format('YYYYMMDD')}.xlsx`)
}
