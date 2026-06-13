/**
 * iMile 到件扫描：API 字段与 Excel 列名对照（同一业务数据，命名不同）。
 *
 * | API 字段           | Excel 列名   | ParsedScanRow 属性   |
 * |--------------------|-------------|----------------------|
 * | scanDate           | 扫描时间     | scanTime             |
 * | waybillNo          | 运单号       | trackingNumber       |
 * | operator           | 扫描员       | scanner              |
 * | routeCode          | 路由编码     | routeCode            |
 * | consigneeZipCode   | 收件人邮编   | consigneeZipCode     |
 * | deliveryStation    | 派件网点     | deliveryStation      |
 * | scanStation        | 扫描网点     | scanStation          |
 * | clientCode         | 商家编码     | clientCode           |
 * | clientName         | 商家名称     | clientName           |
 * | city               | 收件人城市   | consigneeCity        |
 */

export const INBOUND_API_FIELDS = {
  scanDate: 'scanDate',
  waybillNo: 'waybillNo',
  operator: 'operator',
  routeCode: 'routeCode',
  consigneeZipCode: 'consigneeZipCode',
  deliveryStation: 'deliveryStation',
  scanStation: 'scanStation',
  clientCode: 'clientCode',
  clientName: 'clientName',
  city: 'city',
  scanType: 'scanType',
} as const

export const SCAN_ROUTE_CODE_COLUMNS = ['路由编码', 'routeCode'] as const
export const SCAN_CONSIGNEE_ZIP_COLUMNS = ['收件人邮编', 'consigneeZipCode', '邮编'] as const
export const SCAN_DELIVERY_STATION_COLUMNS = ['派件网点', 'deliveryStation'] as const
export const SCAN_STATION_COLUMNS = ['扫描网点', 'scanStation'] as const
export const SCAN_CLIENT_CODE_COLUMNS = ['商家编码', 'clientCode'] as const
export const SCAN_CLIENT_NAME_COLUMNS = ['商家名称', 'clientName'] as const
export const SCAN_CONSIGNEE_CITY_COLUMNS = ['收件人城市', 'city', '收件城市'] as const

export type InboundScanApiRecord = {
  scanDate: string
  waybillNo: string
  operator: string
  scanType: string
  routeCode: string
  consigneeZipCode: string
  deliveryStation: string
  scanStation: string
  clientCode: string
  clientName: string
  consigneeCity: string
}

const EXCLUDED_SCAN_IDENTITIES = new Set(['system', 'adl-shigong8'])

export function isExcludedScanIdentity(value: string): boolean {
  return EXCLUDED_SCAN_IDENTITIES.has(value.trim().toLowerCase())
}

/** System 等账号：仍保留行用于货量，scanner 置空且不参与分拣效率。 */
export function normalizeScannerForVolume(rawOperator: string): {
  scanner: string
  excluded: boolean
} {
  const trimmed = rawOperator.trim()
  const excluded = isExcludedScanIdentity(trimmed)
  return { scanner: excluded ? '' : trimmed, excluded }
}

export function readInboundTextField(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  if (value == null) return ''
  return String(value).trim()
}

export function normalizeInboundApiRecord(raw: unknown): InboundScanApiRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const scanDate = readInboundTextField(row, INBOUND_API_FIELDS.scanDate)
  const waybillNo = readInboundTextField(row, INBOUND_API_FIELDS.waybillNo)
  if (!scanDate || !waybillNo) return null

  return {
    scanDate,
    waybillNo,
    operator: readInboundTextField(row, INBOUND_API_FIELDS.operator),
    scanType: readInboundTextField(row, INBOUND_API_FIELDS.scanType),
    routeCode: readInboundTextField(row, INBOUND_API_FIELDS.routeCode),
    consigneeZipCode: readInboundTextField(row, INBOUND_API_FIELDS.consigneeZipCode),
    deliveryStation: readInboundTextField(row, INBOUND_API_FIELDS.deliveryStation),
    scanStation: readInboundTextField(row, INBOUND_API_FIELDS.scanStation),
    clientCode: readInboundTextField(row, INBOUND_API_FIELDS.clientCode),
    clientName: readInboundTextField(row, INBOUND_API_FIELDS.clientName),
    consigneeCity: readInboundTextField(row, INBOUND_API_FIELDS.city),
  }
}

export type InboundScanRowExtras = Pick<
  InboundScanApiRecord,
  | 'routeCode'
  | 'consigneeZipCode'
  | 'deliveryStation'
  | 'scanStation'
  | 'clientCode'
  | 'clientName'
  | 'consigneeCity'
>

export function readInboundScanRowExtras(record: InboundScanRowExtras) {
  return {
    routeCode: record.routeCode,
    consigneeZipCode: record.consigneeZipCode,
    deliveryStation: record.deliveryStation,
    scanStation: record.scanStation,
    clientCode: record.clientCode,
    clientName: record.clientName,
    consigneeCity: record.consigneeCity,
  }
}
