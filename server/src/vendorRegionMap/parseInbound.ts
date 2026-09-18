export type ParsedInboundScan = {
  waybillNo: string
  routeCode: string
  consigneeZipCode: string
  /** 收件 suburb（iMile consigneeCity，导出表里的「收件人城市」列）；与邮编一起匹配区域包裹价格 */
  consigneeSuburb: string
  courierVendorCode: string
}

function readText(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (value == null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

/** 澳洲邮编为 4 位；兼容 5000 / 5000.0 / "SA 5000" */
export function normalizeZipCode(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.trunc(raw)
    if (n < 0 || n > 9999) return ''
    return String(n).padStart(4, '0')
  }
  const text = String(raw).trim()
  if (!text) return ''
  const asNum = Number(text.replace(/,/g, ''))
  if (Number.isFinite(asNum) && asNum >= 0 && asNum <= 9999) {
    return String(Math.trunc(asNum)).padStart(4, '0')
  }
  const digits = text.replace(/\D/g, '')
  if (digits.length >= 4) return digits.slice(0, 4)
  if (digits.length > 0) return digits.padStart(4, '0')
  return ''
}

/**
 * 从地址文本里抠澳洲 4 位邮编。
 * 常见形态：`Port Elliot SA 5212` / `..., 5212, Australia` / `5212 Australia`
 */
export function extractZipFromAddress(raw: string): string {
  const text = raw.trim()
  if (!text) return ''

  const withState = text.match(/\b(?:SA|NSW|VIC|QLD|WA|TAS|ACT|NT)\s+(\d{4})\b/i)
  if (withState?.[1]) return withState[1]

  const beforeCountry = text.match(/\b(\d{4})\s*(?:,?\s*)?(?:Australia|AU)\b/i)
  if (beforeCountry?.[1]) return beforeCountry[1]

  const trailing = text.match(/(?:^|[\s,])(\d{4})(?:\s*[.,]?\s*)?$/)
  if (trailing?.[1]) return trailing[1]

  return ''
}

function resolveConsigneeZipCode(row: Record<string, unknown>): string {
  const direct = normalizeZipCode(
    readText(row, [
      'consigneeZipCode',
      'consigneePostCode',
      'consigneePostalCode',
      'zipCode',
      'postCode',
      'postalCode',
      'receiverZipCode',
      'receiverPostCode',
    ]),
  )
  if (direct) return direct

  const address = readText(row, [
    'consigneeAddress',
    'consigneeFullAddress',
    'address',
    'deliveryAddress',
    'receiverAddress',
  ])
  return normalizeZipCode(extractZipFromAddress(address))
}

export function parseInboundScanRecord(raw: unknown): ParsedInboundScan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const waybillNo = readText(row, ['waybillNo', 'waybillNO', 'trackingNumber'])
  if (!waybillNo) return null
  return {
    waybillNo,
    routeCode: readText(row, ['routeCode', 'consigneeRouteCode']),
    consigneeZipCode: resolveConsigneeZipCode(row),
    consigneeSuburb: readText(row, ['consigneeCity', 'consigneeSuburb', 'city']),
    courierVendorCode: readText(row, ['courierVendorCode', 'vendorCode']),
  }
}

/**
 * 同一运单可能被多种 scanType 扫多次。包裹数按运单去重：
 * 优先保留已有邮编 / suburb / 路由码的那次。
 */
export function dedupeScansByWaybill(records: unknown[]): ParsedInboundScan[] {
  const byWaybill = new Map<string, ParsedInboundScan>()
  for (const raw of records) {
    const parsed = parseInboundScanRecord(raw)
    if (!parsed) continue
    const existing = byWaybill.get(parsed.waybillNo)
    if (!existing) {
      byWaybill.set(parsed.waybillNo, parsed)
      continue
    }
    if (!existing.consigneeZipCode && parsed.consigneeZipCode) existing.consigneeZipCode = parsed.consigneeZipCode
    if (!existing.consigneeSuburb && parsed.consigneeSuburb) existing.consigneeSuburb = parsed.consigneeSuburb
    if (!existing.routeCode && parsed.routeCode) existing.routeCode = parsed.routeCode
    if (!existing.courierVendorCode && parsed.courierVendorCode) existing.courierVendorCode = parsed.courierVendorCode
  }
  return [...byWaybill.values()]
}
