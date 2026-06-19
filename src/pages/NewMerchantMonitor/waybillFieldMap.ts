export type WaybillRecord = Record<string, unknown>

/**
 * iMile `searchWaybill`（中心运单查询）resultObject.results[] 字段。
 */
export const WAYBILL_API_FIELDS = {
  waybillNo: 'waybillNo',
  mainWaybillNo: 'mainWaybillNo',
  consigneeRouteCode: 'consigneeRouteCode',
  /** 派件司机所属供应商 */
  courierVendor: 'courierVendor',
  /** 派件司机 */
  courier: 'courier',
  /** 派件司机编号 */
  courierCode: 'courierCode',
} as const

function readText(record: WaybillRecord, key: string): string {
  const v = record[key]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

export function readWaybillNo(record: WaybillRecord): string {
  return (
    readText(record, WAYBILL_API_FIELDS.waybillNo) ||
    readText(record, WAYBILL_API_FIELDS.mainWaybillNo)
  )
}

export function readWaybillRouteCode(record: WaybillRecord): string {
  return readText(record, WAYBILL_API_FIELDS.consigneeRouteCode) || '(空)'
}

export function readWaybillVendor(record: WaybillRecord): string {
  return readText(record, WAYBILL_API_FIELDS.courierVendor) || '(空)'
}

export function readWaybillDriverName(record: WaybillRecord): string {
  return readText(record, WAYBILL_API_FIELDS.courier) || '(空)'
}

export function readWaybillDriverCode(record: WaybillRecord): string {
  return readText(record, WAYBILL_API_FIELDS.courierCode) || '-'
}
