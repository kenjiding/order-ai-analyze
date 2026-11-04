import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { i18n } from '../../i18n'
import type { WeightRange, WeightStatItem, WeightStatResult } from './weightStatApi'

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF2' },
}

/** 按自定义重量区间分 sheet，导出每个区间命中的运单明细（运单号/重量/路由码/供应商） */
export async function exportWeightStatExcel(result: WeightStatResult, ranges: WeightRange[]): Promise<void> {
  const t = i18n.t.bind(i18n)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = t('weightStat:export.creator')
  workbook.created = new Date()

  const sortedRanges = ranges.slice().sort((a, b) => a.min - b.min)

  const summarySheet = workbook.addWorksheet(t('weightStat:export.summarySheetName').slice(0, 31))
  summarySheet.columns = [{ width: 16 }, { width: 16 }, { width: 10 }]
  const summaryHeaderRow = summarySheet.getRow(1)
  summaryHeaderRow.getCell(1).value = t('weightStat:export.colRangeLabel')
  summaryHeaderRow.getCell(2).value = t('weightStat:export.colRoute')
  summaryHeaderRow.getCell(3).value = t('weightStat:export.colCount')
  summaryHeaderRow.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: 'FF1A1A1A' } }
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  let summaryRowIdx = 2
  for (const range of sortedRanges) {
    const matched = result.items.filter(
      (item) => item.weight != null && item.weight >= range.min && item.weight <= range.max,
    )
    const countByRoute = new Map<string, number>()
    for (const item of matched) {
      const key = item.routeCode || t('weightStat:dimension.unassigned')
      countByRoute.set(key, (countByRoute.get(key) ?? 0) + 1)
    }
    const rangeLabel = `[${range.min}, ${range.max}]`
    const sortedRoutes = [...countByRoute.entries()].sort((a, b) => b[1] - a[1])
    for (const [routeCode, count] of sortedRoutes) {
      const row = summarySheet.getRow(summaryRowIdx)
      row.getCell(1).value = rangeLabel
      row.getCell(2).value = routeCode
      row.getCell(3).value = count
      row.getCell(3).alignment = { horizontal: 'right' }
      summaryRowIdx++
    }
  }

  for (const range of sortedRanges) {
    const matched: WeightStatItem[] = result.items.filter(
      (item) => item.weight != null && item.weight >= range.min && item.weight <= range.max,
    )

    const sheet = workbook.addWorksheet(`${range.min}-${range.max}`.slice(0, 31))
    sheet.columns = [{ width: 8 }, { width: 22 }, { width: 12 }, { width: 16 }, { width: 24 }]

    const headerRow = sheet.getRow(1)
    headerRow.getCell(1).value = t('weightStat:export.colIndex')
    headerRow.getCell(2).value = t('weightStat:export.colWaybill')
    headerRow.getCell(3).value = t('weightStat:export.colWeight')
    headerRow.getCell(4).value = t('weightStat:export.colRoute')
    headerRow.getCell(5).value = t('weightStat:export.colSupplier')
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11, color: { argb: 'FF1A1A1A' } }
      cell.fill = HEADER_FILL
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    matched.forEach((item, idx) => {
      const row = sheet.getRow(idx + 2)
      row.getCell(1).value = idx + 1
      row.getCell(1).alignment = { horizontal: 'center' }
      row.getCell(2).value = item.waybillNo
      row.getCell(3).value = item.weight
      row.getCell(4).value = item.routeCode
      row.getCell(5).value = item.supplierName || t('weightStat:dimension.unassigned')
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(
    blob,
    t('weightStat:export.filename', {
      station: result.stationCode.replace(/,/g, '_'),
      dates: `${result.startDate}_${result.endDate}`,
    }),
  )
}
