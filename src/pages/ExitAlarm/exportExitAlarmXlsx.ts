import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import type { ExitAlarmExportSheet } from './exitAlarmTypes'

/** Excel 工作表名上限 31；去掉非法字符并避免重名 */
function uniqueSheetName(base: string, used: Set<string>): string {
  const cleaned = String(base || '供应商').replace(/[[\]:*?/\\]/g, '_').trim() || '供应商'
  let name = cleaned.slice(0, 31)
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  for (let i = 2; i < 1000; i++) {
    const suffix = `_${i}`
    const candidate = `${cleaned.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  const fallback = `Sheet_${Date.now()}`.slice(0, 31)
  used.add(fallback)
  return fallback
}

export function exportExitAlarmXlsx(params: {
  stationCode: string
  date: string
  sheets: ExitAlarmExportSheet[]
}): void {
  const { stationCode, date, sheets } = params
  if (sheets.length === 0) return

  const wb = XLSX.utils.book_new()
  const used = new Set<string>()

  for (const sheet of sheets) {
    const rows =
      sheet.rows.length > 0
        ? sheet.rows.map((r) => ({
            运单号: r.waybillNo,
            路由码: r.routeCode,
            派件时间: r.deliveryTime || '—',
            司机: r.courier,
            司机编码: r.courierCode,
            状态: r.status,
          }))
        : [
            {
              运单号: '',
              路由码: '',
              派件时间: '',
              司机: '',
              司机编码: '',
              状态: `无运单（达标 ${sheet.metCount} / 未达标 ${sheet.unmetCount}）`,
            },
          ]

    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [
      { wch: 22 },
      { wch: 14 },
      { wch: 20 },
      { wch: 16 },
      { wch: 14 },
      { wch: 10 },
    ]
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(sheet.vendorName, used))
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, `11点前出仓告警_${stationCode}_${date}.xlsx`)
}
