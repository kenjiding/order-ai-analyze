import { priceBookKey, type PackagePrice } from '../dispatch24hStats/aggregateCells'
import { lookupPostcode } from './postcodeLookup'
import { dedupeScansByWaybill } from './parseInbound'
import {
  buildSupplierMatcher,
  UNMATCHED_SUPPLIER_KEY,
  UNMATCHED_SUPPLIER_NAME,
  type ScopeConfig,
} from './supplierMatcher'
import type { VendorRegionCell, VendorRegionVendor } from './types'

export { UNMATCHED_SUPPLIER_KEY, UNMATCHED_SUPPLIER_NAME }

/** 金额保留两位小数，避免浮点累加的尾巴透到接口上 */
function money(value: number): number {
  return Math.round(value * 100) / 100
}

type Bucket = {
  count: number
  vendorProfit: number
  courierProfit: number
  unpricedCount: number
}

function newBucket(): Bucket {
  return { count: 0, vendorProfit: 0, courierProfit: 0, unpricedCount: 0 }
}

export function aggregateVendorZipCells(input: {
  records: unknown[]
  configs: ScopeConfig[]
  /**
   * 区域包裹价格，key 见 priceBookKey；缺省 = 不算钱（价格表为空时就是这样），
   * 此时全部包裹记入 unpricedPackages，而不是静默按 0 元算。
   */
  priceBook?: Map<string, PackagePrice>
}): {
  vendors: VendorRegionVendor[]
  cells: VendorRegionCell[]
  uniqueWaybills: number
  matchedPackages: number
  unmatchedNoZip: number
  unmatchedNoVendor: number
  unpricedPackages: number
} {
  const matcher = buildSupplierMatcher(input.configs)

  const buckets = new Map<string, Bucket>()
  const scans = dedupeScansByWaybill(input.records)
  let unmatchedNoZip = 0
  let unmatchedNoVendor = 0
  let matchedPackages = 0
  let unpricedPackages = 0

  for (const scan of scans) {
    if (!scan.consigneeZipCode) {
      unmatchedNoZip += 1
      continue
    }
    const unitKeys = matcher.resolveUnitKeys(scan)
    const assigned = unitKeys.length > 0 ? unitKeys : [UNMATCHED_SUPPLIER_KEY]
    if (unitKeys.length === 0) unmatchedNoVendor += 1
    matchedPackages += 1

    // 计价必须落在运单上：同一个邮编下不同 suburb 单价不同，先按邮编汇总票数再乘一个单价会算错
    const priced = input.priceBook?.get(priceBookKey(scan.consigneeZipCode, scan.consigneeSuburb))
    if (!priced) unpricedPackages += 1

    for (const supplierKey of assigned) {
      const key = `${supplierKey}\0${scan.consigneeZipCode}`
      const bucket = buckets.get(key) ?? newBucket()
      bucket.count += 1
      if (priced) {
        bucket.vendorProfit += priced.price - priced.courierPrice
        bucket.courierProfit += priced.courierPrice
      } else {
        bucket.unpricedCount += 1
      }
      buckets.set(key, bucket)
    }
  }

  const cells: VendorRegionCell[] = []
  const unitTotals = new Map<string, { bucket: Bucket; zips: Set<string> }>()
  for (const [key, bucket] of buckets) {
    const [supplierKey, zipCode] = key.split('\0') as [string, string]
    const unit = matcher.units.get(supplierKey)
    const geo = lookupPostcode(zipCode)
    cells.push({
      zipCode,
      supplierKey,
      supplierName: unit?.supplierName ?? UNMATCHED_SUPPLIER_NAME,
      vendorCode: unit?.vendorCode ?? '',
      count: bucket.count,
      vendorProfit: money(bucket.vendorProfit),
      courierProfit: money(bucket.courierProfit),
      unpricedCount: bucket.unpricedCount,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      suburb: geo?.suburb ?? '',
      state: geo?.state ?? '',
    })
    const total = unitTotals.get(supplierKey) ?? { bucket: newBucket(), zips: new Set<string>() }
    total.bucket.count += bucket.count
    total.bucket.vendorProfit += bucket.vendorProfit
    total.bucket.courierProfit += bucket.courierProfit
    total.bucket.unpricedCount += bucket.unpricedCount
    total.zips.add(zipCode)
    unitTotals.set(supplierKey, total)
  }

  cells.sort(
    (a, b) =>
      b.count - a.count ||
      a.zipCode.localeCompare(b.zipCode) ||
      a.supplierKey.localeCompare(b.supplierKey),
  )

  const vendors: VendorRegionVendor[] = [...unitTotals.entries()]
    .map(([supplierKey, total]) => {
      const unit = matcher.units.get(supplierKey)
      return {
        supplierKey,
        supplierName: unit?.supplierName ?? UNMATCHED_SUPPLIER_NAME,
        vendorCode: unit?.vendorCode ?? '',
        packageCount: total.bucket.count,
        vendorProfit: money(total.bucket.vendorProfit),
        courierProfit: money(total.bucket.courierProfit),
        unpricedCount: total.bucket.unpricedCount,
        zipCount: total.zips.size,
      }
    })
    .sort((a, b) => b.packageCount - a.packageCount || a.supplierName.localeCompare(b.supplierName))

  return {
    vendors,
    cells,
    uniqueWaybills: scans.length,
    matchedPackages,
    unmatchedNoZip,
    unmatchedNoVendor,
    unpricedPackages,
  }
}
