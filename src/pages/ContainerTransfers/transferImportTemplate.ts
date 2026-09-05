/**
 * 流转记录批量导入模板。
 *
 * 站点名手打极易对不上后端的账户 id，所以「业务类型 / 转出方 / 接收方」三列用 Excel 原生
 * 数据验证做成下拉，取值写在单独的「站点账户」表里再跨表引用 —— 站点名可能含逗号，
 * 内联列表（"A,B,C"）会被 Excel 拆错，只有引用区域是安全的。
 * 转出方只能是本人绑定的站点，接收方是全部站点，两者范围不同，所以名单出两列。
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
  '大蓝筐数量',
  '银筐数量',
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
  fromAccounts: ContainerAccount[],
  toAccounts: ContainerAccount[],
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

  // 取值表：A 列转出方（本人绑定的站点），B 列接收方（全部站点）
  const refSheet = workbook.addWorksheet(TRANSFER_IMPORT_REF_SHEET)
  refSheet.columns = [{ width: 24 }, { width: 24 }]
  const byName = (list: ContainerAccount[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const sortedFrom = byName(fromAccounts)
  const sortedTo = byName(toAccounts)
  ;(
    [
      [1, '可选转出方', sortedFrom],
      [2, '可选接收方', sortedTo],
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

  const kindList = SELECTABLE_TRANSFER_KINDS.map((kind) => transferKindLabel[kind]).join(',')
  /**
   * 引用区域必须刚好覆盖有名字的行。之前固定引到第 501 行，站点只有十几个时下拉里就跟着
   * 出现几百个空白项：列表拖不动、Excel 的输入自动补全也会被空白项打断。
   * 名单为空时不设验证，A2:A1 是非法区域，Excel 会判文件损坏。
   */
  const rangeOf = (columnLetter: string, size: number) =>
    size > 0 ? `=${TRANSFER_IMPORT_REF_SHEET}!$${columnLetter}$2:$${columnLetter}$${size + 1}` : ''
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
      errorTitle: '取值不合法',
      error: '请从下拉列表中选择',
    }
    /**
     * 站点列不拦手打。Excel 原生下拉固定只显示 8 行、没有搜索，站点几十个时滚起来很痛苦，
     * 强制走下拉等于把人锁死在这个交互里；名字打错有上传预览逐行报错兜底。
     */
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

  // 示例写在说明表而不是数据表，否则会被当成一条真实记录解析进去
  const guide = workbook.addWorksheet(TRANSFER_IMPORT_GUIDE_SHEET)
  guide.columns = [{ width: 100 }]
  const lines = [
    `请只在「${TRANSFER_IMPORT_SHEET}」表里填写数据，本表与「${TRANSFER_IMPORT_REF_SHEET}」表不要改动。`,
    '一行 = 一条流转记录。同一条记录同时含大蓝筐和银筐时，把两个数量填在同一行的两列里。',
    '「大蓝筐数量」「银筐数量」至少填一个；留空表示这条记录不含该品类；填了必须是大于 0 的整数。',
    '「业务类型」点单元格右侧的下拉箭头选择。',
    `「转出方」「接收方」可以用下拉选，站点多时更快的做法是从「${TRANSFER_IMPORT_REF_SHEET}」表复制名字粘过来，或直接手打（忽略空格与大小写，其余要和名单完全一致）。`,
    '「转出方」只能填你自己绑定的站点（见取值表 A 列），填了别的站点整批会被拒；「接收方」不限（B 列）。',
    '站点名对不上系统账户不会丢数据，上传后的预览会逐行指出来，改完再传即可。',
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
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const { saveAs } = await import('file-saver')
  saveAs(blob, `容器流转导入模板-${dayjs().format('YYYYMMDD')}.xlsx`)
}
