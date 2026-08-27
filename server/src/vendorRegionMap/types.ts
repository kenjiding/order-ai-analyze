export type VendorRegionVendor = {
  /** 供应商单位标识 `vendorCode::展示名`；ADL-Lu 与 ADL-City 共用 vendorCode，靠这个分开 */
  supplierKey: string
  supplierName: string
  vendorCode: string
  packageCount: number
  zipCount: number
}

export type VendorRegionCell = {
  zipCode: string
  supplierKey: string
  supplierName: string
  vendorCode: string
  count: number
  lat: number | null
  lng: number | null
  suburb: string
  state: string
}

export type PolygonGeometry = {
  type: 'Polygon'
  coordinates: number[][][]
}

export type MultiPolygonGeometry = {
  type: 'MultiPolygon'
  coordinates: number[][][][]
}

export type PostcodeGeometry = PolygonGeometry | MultiPolygonGeometry

export type VendorRegionZipRegion = {
  zipCode: string
  suburb: string
  totalCount: number
  geometry: PostcodeGeometry
}

export type VendorRegionMapMeta = {
  startDate: string
  endDate: string
  scanFetched: number
  uniqueWaybills: number
  matchedPackages: number
  unmatchedNoZip: number
  unmatchedNoVendor: number
  unmatchedNoGeo: number
  polygonCount: number
  missingPolygons?: string[]
}

export type VendorRegionMapResult = {
  vendors: VendorRegionVendor[]
  cells: VendorRegionCell[]
  zipRegions: VendorRegionZipRegion[]
  meta: VendorRegionMapMeta
}

export type PostcodeCentroid = {
  lat: number
  lng: number
  suburb: string
  state: string
}
