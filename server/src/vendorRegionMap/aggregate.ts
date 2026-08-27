import type { FleetSupplierPushConfig } from '../db/schema'
import { parseRouteCodes, supplierDisplayName } from '../supplierPushConfigs'
import {
  buildRouteCodeVendorsMap,
  isRouteCodeAllowed,
  normCode,
  resolveVendorCodesByRouteCode,
} from '../vendorAnalysis/supplierScope'
import { lookupPostcode } from './postcodeLookup'
import { dedupeScansByWaybill } from './parseInbound'
import type { VendorRegionCell, VendorRegionVendor } from './types'

/** 有邮编但路由码对不上任何供应商配置时，仍上图，便于发现漏配 */
export const UNMATCHED_SUPPLIER_KEY = '__unmatched__'
export const UNMATCHED_SUPPLIER_NAME = '未匹配供应商'

type ScopeConfig = Pick<
  FleetSupplierPushConfig,
  'vendorCode' | 'vendorName' | 'supplierNickname' | 'routeCode'
>

/**
 * 一个「供应商单位」= 同 vendorCode 下同一个展示名的若干条配置。
 *
 * 区域地图取的是 supplierScope 里「逐条配置独立」的那套口径，不是按 vendorCode 合并的那套：
 * ADL-Lu 和 ADL-City 共用 vendorCode SRM2401068，但业务上是两家，靠路由码分开。
 * 合并会让后建的那家整个消失、单量被记到先建的那家名下。
 *
 * 不直接用配置行 id 当单位，是因为同一家会在多个 region 各建一条（ADL-Lu 在 SA 和 system 各一条），
 * 那样又会在筛选里冒出重复项；按展示名归并后，多条配置的路由码取并集。
 */
type SupplierUnit = {
  supplierKey: string
  supplierName: string
  vendorCode: string
  routeCodes: Set<string>
}

function buildSupplierUnits(configs: ScopeConfig[]): Map<string, SupplierUnit> {
  const units = new Map<string, SupplierUnit>()
  for (const config of configs) {
    const vendorCode = normCode(config.vendorCode)
    if (!vendorCode) continue
    const supplierName = supplierDisplayName(config)
    const supplierKey = `${vendorCode}::${supplierName}`
    const unit = units.get(supplierKey) ?? {
      supplierKey,
      supplierName,
      vendorCode,
      routeCodes: new Set<string>(),
    }
    for (const routeCode of parseRouteCodes(config.routeCode ?? '')) unit.routeCodes.add(routeCode)
    units.set(supplierKey, unit)
  }
  return units
}

/**
 * courierVendorCode 只能定位到 vendorCode，落到哪个单位还得靠路由码收窄；
 * iMile 尚未回填承运商时退回纯路由码归属。判定本身仍走 supplierScope 的函数，
 * 这里只是把它的键从 vendorCode 换成 supplierKey。
 */
function resolveUnitKeysForScan(
  scan: { routeCode: string; courierVendorCode: string },
  unitKeysByVendorCode: Map<string, string[]>,
  routeCodeUnitsMap: Map<string, string[]>,
): string[] {
  const courier = normCode(scan.courierVendorCode)
  const byCourier = courier ? unitKeysByVendorCode.get(courier) : undefined
  if (byCourier && byCourier.length > 0) return byCourier
  return resolveVendorCodesByRouteCode(scan.routeCode, routeCodeUnitsMap)
}

export function aggregateVendorZipCells(input: {
  records: unknown[]
  configs: ScopeConfig[]
}): {
  vendors: VendorRegionVendor[]
  cells: VendorRegionCell[]
  uniqueWaybills: number
  matchedPackages: number
  unmatchedNoZip: number
  unmatchedNoVendor: number
} {
  const units = buildSupplierUnits(input.configs)

  const unitKeysByVendorCode = new Map<string, string[]>()
  const routeCodesByUnit = new Map<string, Set<string>>()
  for (const unit of units.values()) {
    const list = unitKeysByVendorCode.get(unit.vendorCode) ?? []
    list.push(unit.supplierKey)
    unitKeysByVendorCode.set(unit.vendorCode, list)
    // 与 supplierScope 一致：路由码为空 = 不收窄，故不建条目
    if (unit.routeCodes.size > 0) routeCodesByUnit.set(unit.supplierKey, unit.routeCodes)
  }
  const routeCodeUnitsMap = buildRouteCodeVendorsMap(routeCodesByUnit)

  const counts = new Map<string, number>()
  const scans = dedupeScansByWaybill(input.records)
  let unmatchedNoZip = 0
  let unmatchedNoVendor = 0
  let matchedPackages = 0

  for (const scan of scans) {
    if (!scan.consigneeZipCode) {
      unmatchedNoZip += 1
      continue
    }
    const unitKeys = resolveUnitKeysForScan(scan, unitKeysByVendorCode, routeCodeUnitsMap).filter(
      (supplierKey) => isRouteCodeAllowed(supplierKey, scan.routeCode, routeCodesByUnit),
    )
    const assigned = unitKeys.length > 0 ? unitKeys : [UNMATCHED_SUPPLIER_KEY]
    if (unitKeys.length === 0) unmatchedNoVendor += 1
    matchedPackages += 1
    for (const supplierKey of assigned) {
      const key = `${supplierKey}\0${scan.consigneeZipCode}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  const cells: VendorRegionCell[] = []
  const unitTotals = new Map<string, { packageCount: number; zips: Set<string> }>()
  for (const [key, count] of counts) {
    const [supplierKey, zipCode] = key.split('\0') as [string, string]
    const unit = units.get(supplierKey)
    const geo = lookupPostcode(zipCode)
    cells.push({
      zipCode,
      supplierKey,
      supplierName: unit?.supplierName ?? UNMATCHED_SUPPLIER_NAME,
      vendorCode: unit?.vendorCode ?? '',
      count,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      suburb: geo?.suburb ?? '',
      state: geo?.state ?? '',
    })
    const total = unitTotals.get(supplierKey) ?? { packageCount: 0, zips: new Set<string>() }
    total.packageCount += count
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
      const unit = units.get(supplierKey)
      return {
        supplierKey,
        supplierName: unit?.supplierName ?? UNMATCHED_SUPPLIER_NAME,
        vendorCode: unit?.vendorCode ?? '',
        packageCount: total.packageCount,
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
  }
}
