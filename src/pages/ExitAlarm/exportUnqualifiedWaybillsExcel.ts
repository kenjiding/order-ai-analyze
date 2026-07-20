import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import type { ExitAlarmPushNowResult } from './exitAlarmApi'

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF2' },
}

/** sheet 名不允许的字符及长度限制（Excel 上限 31 字符） */
function sanitizeSheetName(name: string, usedNames: Set<string>): string {
  let base = name.replace(/[\\/*?:[\]]/g, '_').trim().slice(0, 31) || '未知供应商'
  let candidate = base
  let suffix = 2
  while (usedNames.has(candidate)) {
    const suffixText = `_${suffix}`
    candidate = `${base.slice(0, 31 - suffixText.length)}${suffixText}`
    suffix++
  }
  usedNames.add(candidate)
  return candidate
}

/** 按供应商分 sheet，导出本次「立刻推送」中未在 11 点前出仓（未达标）的运单号 */
export async function exportUnqualifiedWaybillsExcel(result: ExitAlarmPushNowResult): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '11点前出仓告警'
  workbook.created = new Date()

  const usedNames = new Set<string>()
  for (const { vendorName, waybillNos } of result.unqualifiedByVendor) {
    const sheet = workbook.addWorksheet(sanitizeSheetName(vendorName, usedNames))
    sheet.columns = [{ width: 10 }, { width: 28 }]

    const headerRow = sheet.getRow(1)
    headerRow.getCell(1).value = '序号'
    headerRow.getCell(2).value = '运单号'
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11, color: { argb: 'FF1A1A1A' } }
      cell.fill = HEADER_FILL
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    waybillNos.forEach((waybillNo, idx) => {
      const row = sheet.getRow(idx + 2)
      row.getCell(1).value = idx + 1
      row.getCell(1).alignment = { horizontal: 'center' }
      row.getCell(2).value = waybillNo
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, `11点前出仓告警_未达标运单_${result.stationCode}_${result.date}.xlsx`)
}
