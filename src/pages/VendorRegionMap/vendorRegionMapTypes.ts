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

export type VendorRegionZipRegion = {
  zipCode: string
  suburb: string
  totalCount: number
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
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

export const ADELAIDE_MAP_CENTER = { lng: 138.6007, lat: -34.9285 }
export const ADELAIDE_MAP_ZOOM = 10.4
export const DEFAULT_RANGE_START = '2026-08-24'
export const DEFAULT_RANGE_END = '2026-08-25'

/** 本仓固定地址：Gillman 工业区 */
export const WAREHOUSE = {
  name: '本仓库',
  address: '4 Portsmouth Ct, Gillman SA 5013',
  lng: 138.5273,
  lat: -34.8432,
} as const

/**
 * 距离圈是「概览工具」：一眼看出哪片区在 50 km 内。放大到看具体郊区时它就是冗余
 * （弹窗里已经写了距仓库多远），所以图层按 zoom 自动淡出。
 * 档位取整十整百，减到 5 档——9 档的墨量会盖住底图密度。
 */
export const WAREHOUSE_RING_KM = [10, 25, 50, 100, 150] as const

export function warehouseRingScaleLabel(): string {
  return `${WAREHOUSE_RING_KM.join(' / ')} km`
}
