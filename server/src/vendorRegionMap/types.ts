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

/** 邮区内的路由码票量，供地图在邮区中心点附近渲染路由码标签；空路由码不产出这条数据 */
export type VendorRegionRouteCode = {
  zipCode: string
  supplierKey: string
  routeCode: string
  count: number
  /** 派件站点（iMile deliveryStation），同一路由码下唯一稳定；没有值时为空字符串 */
  deliveryStation: string
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
  routes: VendorRegionRouteCode[]
  zipRegions: VendorRegionZipRegion[]
  meta: VendorRegionMapMeta
}

export type PostcodeCentroid = {
  lat: number
  lng: number
  suburb: string
  state: string
}

// 供应商货量趋势相关类型（VendorTrendDailyPoint / VendorTrendSupplier / VendorVolumeTrendRawResult 等）
// 挪到了 shared/vendorRegionMap/trendPeriodAggregate.ts —— 前后端共用同一份定义，
// 阶段二（脏数据剔除/按周合桶/峰谷环比）跑在前端，两边类型对不上会直接编译报错。
