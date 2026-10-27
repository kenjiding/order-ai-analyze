/**
 * 收件地址导入模板表头。顺序、可见文案与单元格批注（title:<field>）均需与上游导入系统的
 * 原始模版一致——该系统按批注里的 field key 识别列，而非按可见表头文字，批注缺失会导致
 * 上传时报“未能识别订单号”等错误。
 */
const TEMPLATE_HEADERS: Array<{ label: string; field: string }> = [
  { label: '运单号*', field: 'waybillNo' },
  { label: '收件人', field: 'consigneeContact' },
  { label: '收件电话', field: 'consigneePhone' },
  { label: '收件备用电话', field: 'consigneeMobile' },
  { label: '收件whatsApp', field: 'consigneeWhatsApp' },
  { label: '收件人邮箱', field: 'consigneeEmail' },
  { label: '收件省', field: 'consigneeProvince' },
  { label: '收件市', field: 'consigneeCity' },
  { label: '收件区', field: 'consigneeArea' },
  { label: '社区', field: 'consigneeSuburb' },
  { label: '邮编', field: 'consigneeZipCode' },
  { label: '街道', field: 'consigneeStreetName' },
  { label: '街道号', field: 'consigneeExternalNumber' },
  { label: '门牌号', field: 'consigneeInternalNumber' },
  { label: '详细地址', field: 'consigneeAddress' },
  { label: '收件人短地址', field: 'consigneeShortAddress' },
  { label: '地址经度', field: 'consigneeLongitude' },
  { label: '地址纬度', field: 'consigneeLatitude' },
  { label: '收件人ID', field: 'consigneeId' },
  { label: '商品名称', field: 'sku' },
  { label: '货物类别', field: 'batterType' },
  { label: 'SKU数量', field: 'skuQty' },
  { label: '代收货款', field: 'collectingMoney' },
  { label: '总重量', field: 'totalWeight' },
  { label: '总体积', field: 'totalVolume' },
  { label: '配送要求', field: 'deliveryRequirements' },
  { label: '运单备注', field: 'description' },
  { label: '是否允许拆包', field: 'isSupportUnpack' },
  { label: '出口申报价值', field: 'exportDeclarePrice' },
  { label: '出口申报价值币种', field: 'exportDeclareCurrency' },
  { label: '生产销售单位', field: 'businessEntityName' },
  { label: '企业信用代码', field: 'usci' },
  { label: '平台名称', field: 'businessPlatformName' },
]

const WAYBILL_COLUMN = 1 // A
const CITY_COLUMN = TEMPLATE_HEADERS.findIndex((h) => h.field === 'consigneeCity') + 1 // H
const ZIP_COLUMN = TEMPLATE_HEADERS.findIndex((h) => h.field === 'consigneeZipCode') + 1 // K

export type AddressVerifyTemplateRow = {
  orderNo: string
  resolvedCity: string
  resolvedPostcode: string
}

function timestamp(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14)
}

export async function exportAddressVerifyTemplate(
  rows: AddressVerifyTemplateRow[],
  options: { sheetName: string; fileNamePrefix: string },
): Promise<void> {
  const { default: ExcelJSModule } = await import('exceljs')
  const workbook = new ExcelJSModule.Workbook()
  const sheet = workbook.addWorksheet(options.sheetName)

  const headerRow = sheet.getRow(1)
  TEMPLATE_HEADERS.forEach(({ label, field }, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = label
    cell.note = `title:${field}`
    cell.font = { bold: true }
  })
  headerRow.commit()

  rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 2)
    excelRow.getCell(WAYBILL_COLUMN).value = row.orderNo
    excelRow.getCell(CITY_COLUMN).value = row.resolvedCity
    excelRow.getCell(ZIP_COLUMN).value = row.resolvedPostcode
    excelRow.commit()
  })

  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer
  const { saveAs } = await import('file-saver')
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${options.fileNamePrefix}${timestamp()}.xlsx`,
  )
}
