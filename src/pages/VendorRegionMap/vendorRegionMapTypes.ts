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

/** 供应商货量趋势：单个供应商在某一天的票量 */
export type VendorTrendDailyPoint = {
  date: string
  supplierKey: string
  count: number
}

/** 供应商货量趋势：单个供应商的某条路由码在某一天的票量 */
export type VendorTrendRoutePoint = {
  date: string
  supplierKey: string
  routeCode: string
  count: number
}

export type VendorTrendSupplier = {
  supplierKey: string
  supplierName: string
  vendorCode: string
  totalCount: number
  dailyAvg: number
  peakCount: number
  peakDate: string
  lowCount: number
  lowDate: string
  /** 环比：区间对半切，前半段日均 */
  prevAvg: number
  /** 环比：区间对半切，后半段日均 */
  recentAvg: number
  /** (recentAvg - prevAvg) / prevAvg；prevAvg 为 0 时为 null（区间内新增的供应商） */
  changeRate: number | null
  /** 区间内出现过的路由码数，作为运力规模的代理指标 */
  routeCodeCount: number
}

export type VendorVolumeTrendMeta = {
  startDate: string
  endDate: string
  days: number
  uniqueWaybills: number
  unmatchedNoVendor: number
  /** 拉取失败的日期：这些天不计入任何统计，必须在 UI 上显式标出 */
  failedDates: string[]
  /** endDate 是今天时为 true —— 当天数据不完整，已被排除出环比计算 */
  lastDayPartial: boolean
  /** 实际参与环比计算的日期（已剔除失败日与不完整的当天） */
  comparableDates: string[]
}

export type VendorVolumeTrendResult = {
  /** 完整日期轴，含零票的天；不含拉取失败的天 */
  dates: string[]
  suppliers: VendorTrendSupplier[]
  daily: VendorTrendDailyPoint[]
  routeDaily: VendorTrendRoutePoint[]
  meta: VendorVolumeTrendMeta
}

/** 路由码为空的扫描归入这一行 */
export const NO_ROUTE_CODE_LABEL = '(无路由码)'
export const UNMATCHED_SUPPLIER_KEY = '__unmatched__'
/** 趋势 Tab 默认选中的折线条数：再多线就糊成一团了 */
export const TREND_DEFAULT_SELECTED_COUNT = 8
export const TREND_MAX_RANGE_DAYS = 31
