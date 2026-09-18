/**
 * 区域包裹价格批量导入：浏览器端解析表格，按 postcode + suburb 去重。
 * 列头对应价格表原文 postcode / suburb / price / vendor，同时兼容中文表头。
 */
import * as XLSX from 'xlsx'

export type ImportedPrice = {
  postcode: string
  suburb: string
  price: number
  courierPrice: number
  vendorCode: string
  vendorName: string
}

/** 派送员价格默认口径：比包裹价格低 0.25，取两位小数且不为负（与后端 defaultCourierPrice 同口径） */
export function defaultCourierPrice(price: number): number {
  return Math.max(Math.round((price - 0.25) * 100) / 100, 0)
}

/** iMile 供应商编码，价格表里跟在名称后面，用空格或「|」隔开 */
const VENDOR_CODE_PATTERN = /\bSRM\d+\b/i

/**
 * 拆分价格表的 vendor 列：
 * 「CAO XIAOHUA SRM2500934」→ SRM2500934 + CAO XIAOHUA
 * 「SPORT SERVICES PTY LTD | SRM2500649」→ SRM2500649 + SPORT SERVICES PTY LTD
 * 没有 SRM 编码的（如按件数计价的备注）只留名称，编码为空。
 */
export function splitVendorCell(raw: string): { vendorCode: string; vendorName: string } {
  const matched = VENDOR_CODE_PATTERN.exec(raw)
  const vendorCode = matched ? matched[0].toUpperCase() : ''
  const vendorName = (matched ? raw.slice(0, matched.index) : raw).trim().replace(/\|$/, '').trim()
  return { vendorCode, vendorName }
}

export type PriceImportResult =
  | { ok: true; prices: ImportedPrice[]; total: number; duplicates: number; invalid: number }
  | { ok: false; error: string }

export const PRICE_IMPORT_MAX_ROWS = 5000

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/[\s_\-./]/g, '')
    .toLowerCase()
}

const isPostcodeHeader = (h: string) => ['postcode', 'postalcode', '邮编'].some((k) => h.includes(k))
const isSuburbHeader = (h: string) => ['suburb', '区域', '城区'].some((k) => h.includes(k))
const isPriceHeader = (h: string) => h === 'price' || ['价格', '单价'].some((k) => h.includes(k))
const isVendorHeader = (h: string) => ['vendor', 'supplier', '供应商'].some((k) => h.includes(k))
const isCourierPriceHeader = (h: string) =>
  ['courierprice', 'driverprice', '派送员价格', '司机价格'].some((k) => h.includes(k))

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\uFEFF/g, '').trim()
}

/** 解析已转成二维数组的表格内容 */
export function parseRegionPackagePriceMatrix(matrix: unknown[][]): PriceImportResult {
  const headerRow = matrix.find((line) => line.some((cell) => isPostcodeHeader(normalizeHeader(cell))))
  if (!headerRow) return { ok: false, error: 'missingPostcodeColumn' }
  const headers = headerRow.map((cell) => normalizeHeader(cell))
  const postcodeAt = headers.findIndex(isPostcodeHeader)
  const suburbAt = headers.findIndex(isSuburbHeader)
  // 先认派送员价格列，免得它被 isPriceHeader 的「价格」子串抢走
  const courierPriceAt = headers.findIndex(isCourierPriceHeader)
  const priceAt = headers.findIndex((h, i) => i !== courierPriceAt && isPriceHeader(h))
  const vendorAt = headers.findIndex(isVendorHeader)
  if (suburbAt < 0) return { ok: false, error: 'missingSuburbColumn' }
  if (priceAt < 0) return { ok: false, error: 'missingPriceColumn' }

  const body = matrix.slice(matrix.indexOf(headerRow) + 1)
  const seen = new Set<string>()
  const prices: ImportedPrice[] = []
  let duplicates = 0
  let invalid = 0
  let total = 0

  for (const line of body) {
    const postcode = cellToText(line[postcodeAt])
    const suburb = cellToText(line[suburbAt])
    const priceText = cellToText(line[priceAt])
    if (!postcode && !suburb && !priceText) continue
    total += 1
    // Number('') === 0，空价格必须先挡掉，否则整行会被当成 0 元导入
    const price = priceText ? Number(priceText) : Number.NaN
    if (!postcode || postcode.length > 16 || !suburb || !Number.isFinite(price) || price < 0) {
      invalid += 1
      continue
    }
    const key = `${postcode.toUpperCase()}|${suburb.toUpperCase()}`
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    // 表格没有派送员价格列（或该行留空）时按默认口径推导
    const courierText = courierPriceAt < 0 ? '' : cellToText(line[courierPriceAt])
    const courierParsed = courierText ? Number(courierText) : Number.NaN
    const courierPrice =
      Number.isFinite(courierParsed) && courierParsed >= 0 ? courierParsed : defaultCourierPrice(price)
    const vendor = splitVendorCell(vendorAt < 0 ? '' : cellToText(line[vendorAt]))
    prices.push({
      postcode,
      suburb: suburb.slice(0, 128),
      price,
      courierPrice,
      vendorCode: vendor.vendorCode.slice(0, 64),
      vendorName: vendor.vendorName.slice(0, 255),
    })
  }

  if (prices.length === 0) return { ok: false, error: 'noValidRows' }
  if (prices.length > PRICE_IMPORT_MAX_ROWS) return { ok: false, error: 'tooManyRows' }
  return { ok: true, prices, total, duplicates, invalid }
}

export async function parseRegionPackagePriceFile(file: File): Promise<PriceImportResult> {
  const name = file.name.toLowerCase()
  try {
    const workbook = name.endsWith('.csv')
      ? XLSX.read(await file.text(), { type: 'string' })
      : name.endsWith('.xlsx') || name.endsWith('.xls')
        ? XLSX.read(await file.arrayBuffer(), { type: 'array' })
        : null
    if (!workbook) return { ok: false, error: 'unsupportedType' }
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    if (!sheet) return { ok: false, error: 'emptySheet' }
    return parseRegionPackagePriceMatrix(
      XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false }),
    )
  } catch (error) {
    console.error('[region-package-price-import] 解析失败', error)
    return { ok: false, error: 'parseFailed' }
  }
}
