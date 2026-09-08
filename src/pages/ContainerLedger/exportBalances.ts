/** 容器台账导出：所见即所得地把当前列表落成一张 xlsx，列与页面表格一一对应 */
import { saveAs } from 'file-saver'
import type { TFunction } from 'i18next'
import * as XLSX from 'xlsx-js-style'
import { applySheetCenterAlignment } from '../../utils/xlsxCenteredSheet'
import type { ContainerBalance } from '../../containerManagement/types'
import { showToast } from '../../utils/toast'

const COLUMN_WIDTHS = [24, 14, 16, 10, 20]

function timestamp(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14)
}

export function exportBalancesToXlsx(rows: ContainerBalance[], t: TFunction<'container'>): void {
  if (rows.length === 0) {
    showToast(t('ledger.exportEmpty'), 'error')
    return
  }
  const data = rows.map((row) => ({
    [t('ledger.colAccount')]: row.accountName,
    [t('ledger.colAccountKind')]: t(`accountKind.${row.accountKind}`),
    [t('ledger.colType')]: t(`containerType.${row.containerType}`),
    [t('ledger.colQuantity')]: row.quantity,
    [t('ledger.colUpdatedAt')]: new Date(row.updatedAt).toLocaleString(),
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  applySheetCenterAlignment(ws)
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, t('ledger.exportSheetName'))
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
  saveAs(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${t('ledger.exportFileNamePrefix')}${timestamp()}.xlsx`,
  )
}
