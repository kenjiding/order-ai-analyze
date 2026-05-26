import {
  buildScannerHourlyPivotByDate,
  scannerHourSlotLabel,
  type ScannerEfficiencyResult,
  type ScannerHourlyPivotDay,
} from './aggregates'
import type { DataTableColumn, DataTableRow } from './components/ui'
import { formatInteger } from './formatAndParse'

export function buildScannerHourlyPivotColumns(hours: number[]): DataTableColumn[] {
  return [
    { key: 'scanner', title: '扫描员' },
    ...hours.map((h) => ({
      key: `h${h}`,
      title: scannerHourSlotLabel(h),
      render: (row: DataTableRow) => {
        const v = Number(row[`h${h}`])
        if (row.isScannerHourlyPivotFooter) return formatInteger(v)
        return v === 0 ? '—' : formatInteger(v)
      },
    })),
    {
      key: 'dayTotal',
      title: '当日合计',
      render: (row: DataTableRow) => formatInteger(Number(row.dayTotal)),
    },
  ]
}

export function scannerHourlyPivotToDataTableRows(pivot: ScannerHourlyPivotDay): DataTableRow[] {
  const body = pivot.scannerRows.map(({ scanner, byHour, dayTotal }) => {
    const row: DataTableRow = { scanner, dayTotal }
    pivot.hours.forEach((h, i) => {
      row[`h${h}`] = byHour[i]
    })
    return row
  })
  const footer: DataTableRow = {
    scanner: '时段合计',
    isScannerHourlyPivotFooter: true,
    dayTotal: pivot.grandTotal,
  }
  pivot.hours.forEach((h, i) => {
    footer[`h${h}`] = pivot.columnTotals[i]
  })
  return [...body, footer]
}

export function buildScannerHourlyPivotTables(
  hourlyRows: ScannerEfficiencyResult['scannerHourlyRows'],
) {
  if (!hourlyRows?.length) return []
  return buildScannerHourlyPivotByDate(hourlyRows).map((pivot) => ({
    date: pivot.date,
    hours: pivot.hours,
    rows: scannerHourlyPivotToDataTableRows(pivot),
  }))
}

/** 某日按小时透视表一行数据（表格 + hours 索引），便于推送等新场景复用 */
export type ScannerHourlyPivotTableItem = ReturnType<typeof buildScannerHourlyPivotTables>[number]
