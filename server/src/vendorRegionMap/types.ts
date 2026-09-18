export type VendorRegionVendor = {
  /** 供应商单位标识 `vendorCode::展示名`；ADL-Lu 与 ADL-City 共用 vendorCode，靠这个分开 */
  supplierKey: string
  supplierName: string
  vendorCode: string
  packageCount: number
  /** 理论供应商利润 Σ(price - courierPrice)，按到件量算，不扣未签收 */
  vendorProfit: number
  /** 理论司机利润 Σ courierPrice，口径同上 */
  courierProfit: number
  /** 没在价格表里匹配到单价的票数：这些票一分钱没算进两个利润 */
  unpricedCount: number
  zipCount: number
}

export type VendorRegionCell = {
  zipCode: string
  supplierKey: string
  supplierName: string
  vendorCode: string
  count: number
  vendorProfit: number
  courierProfit: number
  unpricedCount: number
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
  /** 没匹配到区域包裹价格的票数（按运单去重后计），两个利润里不含它们 */
  unpricedPackages: number
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
  /** 环比：可比区间对半切，前半段日均 */
  prevAvg: number
  /** 环比：可比区间对半切，后半段日均 */
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
