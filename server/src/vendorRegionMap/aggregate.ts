import { priceBookKey, type PackagePrice } from '../dispatch24hStats/aggregateCells'
import { lookupPostcode } from './postcodeLookup'
import { dedupeScansByWaybill } from './parseInbound'
import {
  buildSupplierMatcher,
  UNMATCHED_SUPPLIER_KEY,
  UNMATCHED_SUPPLIER_NAME,
  type ScopeConfig,
} from './supplierMatcher'
import type { VendorRegionCell, VendorRegionRouteCode, VendorRegionVendor } from './types'

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
  routes: VendorRegionRouteCode[]
  uniqueWaybills: number
  matchedPackages: number
  unmatchedNoZip: number
  unmatchedNoVendor: number
  unpricedPackages: number
} {
  const matcher = buildSupplierMatcher(input.configs)

  const buckets = new Map<string, Bucket>()
  const routeCounts = new Map<string, number>()
  /** 派件站点同一路由码下唯一稳定，取第一次遇到的值即可，不需要众数 */
  const routeDeliveryStations = new Map<string, string>()
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

    const routeCode = scan.routeCode.trim()
    // 同一邮区常常覆盖好几个郊区（如 5114 邮区同时含 Craigmore 和 One Tree Hill），密度、柱体、
    // 路由码标签都按邮区+郊区一起分组，这样地图才能把这些东西摆在实际服务的那个郊区，而不是整个邮区共用一个点/一个面
    const suburb = scan.consigneeSuburb.trim().toUpperCase()

    for (const supplierKey of assigned) {
      const key = `${supplierKey}\0${scan.consigneeZipCode}\0${suburb}`
      const bucket = buckets.get(key) ?? newBucket()
      bucket.count += 1
      if (priced) {
        bucket.vendorProfit += priced.price - priced.courierPrice
        bucket.courierProfit += priced.courierPrice
      } else {
        bucket.unpricedCount += 1
      }
      buckets.set(key, bucket)

      // 空路由码不产出地图标签，避免在每个邮区都钉一个「无路由码」的孤零零标签
      if (routeCode) {
        const routeKey = `${key}\0${routeCode}`
        routeCounts.set(routeKey, (routeCounts.get(routeKey) ?? 0) + 1)
        if (!routeDeliveryStations.has(routeKey) && scan.deliveryStation) {
          routeDeliveryStations.set(routeKey, scan.deliveryStation)
        }
      }
    }
  }

  const cells: VendorRegionCell[] = []
  const unitTotals = new Map<string, { bucket: Bucket; zips: Set<string> }>()
  for (const [key, bucket] of buckets) {
    const [supplierKey, zipCode, suburb] = key.split('\0') as [string, string, string]
    const unit = matcher.units.get(supplierKey)
    // 邮编中心点是同步兜底：郊区真实质心要查 ABS（异步），这个函数是同步纯聚合，交给调用方（router）覆盖升级
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
      suburb,
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

  const routes: VendorRegionRouteCode[] = [...routeCounts.entries()]
    .map(([key, count]) => {
      const [supplierKey, zipCode, suburb, routeCode] = key.split('\0') as [string, string, string, string]
      return {
        zipCode,
        supplierKey,
        routeCode,
        suburb,
        count,
        deliveryStation: routeDeliveryStations.get(key) ?? '',
        // 郊区质心坐标要查 ABS（异步、需要外部请求），这个函数是同步纯聚合，交给调用方（router）补上
        lat: null,
        lng: null,
      }
    })
    .sort((a, b) => b.count - a.count || a.routeCode.localeCompare(b.routeCode))

  return {
    vendors,
    cells,
    routes,
    uniqueWaybills: scans.length,
    matchedPackages,
    unmatchedNoZip,
    unmatchedNoVendor,
    unpricedPackages,
  }
}
