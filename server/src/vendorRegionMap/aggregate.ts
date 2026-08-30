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
  const matcher = buildSupplierMatcher(input.configs)

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
    const unitKeys = matcher.resolveUnitKeys(scan)
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
    const unit = matcher.units.get(supplierKey)
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
      const unit = matcher.units.get(supplierKey)
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
