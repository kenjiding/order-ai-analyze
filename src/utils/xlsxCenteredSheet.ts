import * as XLSX from 'xlsx-js-style'

/** 为工作表全部已有单元格设置水平/垂直居中；首行可选加粗（表头）。 */
export function applySheetCenterAlignment(
  ws: XLSX.WorkSheet,
  options?: { headerBold?: boolean },
): void {
  const ref = ws['!ref']
  if (!ref) return

  const range = XLSX.utils.decode_range(ref)
  const headerBold = options?.headerBold ?? true

  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (!cell) continue
      const isHeader = r === range.s.r
      cell.s = {
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        ...(headerBold && isHeader ? { font: { bold: true } } : {}),
      }
    }
  }
}
