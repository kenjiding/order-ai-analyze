import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { i18n } from '../../i18n'
import type { ExitAlarmPushNowResult } from './exitAlarmApi'

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF2' },
}

/** sheet 名不允许的字符及长度限制（Excel 上限 31 字符） */
function sanitizeSheetName(name: string, usedNames: Set<string>): string {
  const unknownVendor = i18n.t('exitAlarm:export.unknownVendor')
  let base = name.replace(/[\\/*?:[\]]/g, '_').trim().slice(0, 31) || unknownVendor
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

/** 按供应商分 sheet，导出本次「立刻推送」中未在阈值前出仓（未达标）的运单号，含主统计与路由码白名单两部分（「类型」列区分） */
export async function exportUnqualifiedWaybillsExcel(result: ExitAlarmPushNowResult): Promise<void> {
  const t = i18n.t.bind(i18n)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = t('exitAlarm:export.creator')
  workbook.created = new Date()

  const usedNames = new Set<string>()
  for (const { vendorName, waybillNos, whitelistWaybillNos } of result.unqualifiedByVendor) {
    const sheet = workbook.addWorksheet(sanitizeSheetName(vendorName, usedNames))
    sheet.columns = [{ width: 10 }, { width: 28 }, { width: 14 }]

    const headerRow = sheet.getRow(1)
    headerRow.getCell(1).value = t('exitAlarm:export.colIndex')
    headerRow.getCell(2).value = t('exitAlarm:export.colWaybill')
    headerRow.getCell(3).value = t('exitAlarm:export.colType')
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11, color: { argb: 'FF1A1A1A' } }
      cell.fill = HEADER_FILL
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    const rows = [
      ...waybillNos.map((waybillNo) => ({ waybillNo, type: t('exitAlarm:export.typeMain') })),
      ...whitelistWaybillNos.map((waybillNo) => ({ waybillNo, type: t('exitAlarm:export.typeWhitelist') })),
    ]
    rows.forEach(({ waybillNo, type }, idx) => {
      const row = sheet.getRow(idx + 2)
      row.getCell(1).value = idx + 1
      row.getCell(1).alignment = { horizontal: 'center' }
      row.getCell(2).value = waybillNo
      row.getCell(3).value = type
      row.getCell(3).alignment = { horizontal: 'center' }
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(
    blob,
    t('exitAlarm:export.filename', { station: result.stationCode, dates: result.dates.join('_') }),
  )
}
