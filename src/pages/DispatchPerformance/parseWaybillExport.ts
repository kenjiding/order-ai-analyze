/**
 * 「上传运单表结算」的表格解析：iMile「中心运单查询」导出的 xlsx → searchWaybill 接口的字段名。
 *
 * 只取结算用得到的列，其余丢弃，上万行也只发几 MB 给后端。
 * 时间列原样保留字符串（导出与接口同为 iMile 门户的墨尔本时间口径），不做时区换算。
 */
import * as XLSX from 'xlsx'

/** searchWaybill 字段名 → 中心运单查询表头 */
const COLUMN_MAP = {
  waybillNo: '运单号',
  deliveryTime: '派件时间',
  signDate: '签收时间',
  lastProblemDate: '最新问题件时间',
  problemReason: '最新问题件原因',
  courier: '派件司机',
  courierCode: '派件司机编号',
  courierVendorCode: '派件司机所属供应商编码',
  clientCode: '商家编号',
  consigneeRouteCode: '路由码',
  consigneeZipCode: '邮编',
  consigneeCity: '收件市',
  consigneeProvince: '收件省',
  consigneeAddress: '收件人详细地址',
  /** 表格只有网点名没有编码，后端按站点展示名比对 */
  lastScanSiteName: '最新扫描网点',
} as const

export type UploadWaybillRecord = Record<keyof typeof COLUMN_MAP, string>

/** 解析多个导出文件并按运单号去重（同一单出现多次时以后读到的为准） */
export async function parseWaybillExports(files: File[]): Promise<UploadWaybillRecord[]> {
  const byNo = new Map<string, UploadWaybillRecord>()
  for (const file of files) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false }) : []
    if (rows.length > 0 && !(COLUMN_MAP.waybillNo in rows[0])) {
      throw new Error(`「${file.name}」没有「运单号」列，不是中心运单查询导出的表格`)
    }
    for (const row of rows) {
      const record = Object.fromEntries(
        Object.entries(COLUMN_MAP).map(([key, header]) => [key, String(row[header] ?? '').trim()]),
      ) as UploadWaybillRecord
      if (record.waybillNo) byNo.set(record.waybillNo, record)
    }
  }
  return [...byNo.values()]
}
