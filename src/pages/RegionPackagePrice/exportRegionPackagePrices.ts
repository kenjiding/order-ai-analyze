/** 区域包裹价格导出：所见即所得地把当前列表落成一张 xlsx，列与页面表格一一对应 */
import { saveAs } from 'file-saver'
import type { TFunction } from 'i18next'
import * as XLSX from 'xlsx-js-style'
import { applySheetCenterAlignment } from '../../utils/xlsxCenteredSheet'
import { showToast } from '../../utils/toast'
import type { RegionPackagePrice } from './RegionPackagePricePage'

const COLUMN_WIDTHS = [12, 28, 12, 14, 14, 16, 32]

function timestamp(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14)
}

export function exportRegionPackagePricesToXlsx(
  rows: RegionPackagePrice[],
  t: TFunction<'regionPackagePrice'>,
): void {
  if (rows.length === 0) {
    showToast(t('exportEmpty'), 'error')
    return
  }
  const data = rows.map((row) => ({
    [t('colPostcode')]: row.postcode,
    [t('colSuburb')]: row.suburb,
    [t('colPrice')]: row.price,
    [t('colCourierPrice')]: row.courierPrice,
    [t('colPrePrice')]: row.prePrice ?? '',
    [t('exportColVendorCode')]: row.vendorCode,
    [t('colVendor')]: row.vendorName,
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  applySheetCenterAlignment(ws)
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, t('exportSheetName'))
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
  saveAs(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${t('exportFileNamePrefix')}${timestamp()}.xlsx`,
  )
}
