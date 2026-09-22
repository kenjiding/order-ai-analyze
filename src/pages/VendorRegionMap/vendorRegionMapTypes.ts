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

export type VendorRegionZipRegion = {
  zipCode: string
  suburb: string
  totalCount: number
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

/** 邮区内的路由码票量，供地图在邮区中心点附近渲染路由码标签；空路由码不产出这条数据 */
export type VendorRegionRouteCode = {
  zipCode: string
  supplierKey: string
  routeCode: string
  count: number
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
  /** 没匹配到区域包裹价格的票数，两个利润里不含它们 */
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

/**
 * 柱高表达的指标。
 *
 * 两个利润是**理论值**：按到件量 × 区域包裹价格算，不看包裹最终是否签收
 * （到件扫描接口不返回签收状态）。与「出仓派签达成分析」的实收金额口径不同、数也对不上，
 * 那边只算签收成功的包裹，因此这里恒偏大。
 */
export const MAP_METRICS = ['count', 'vendorProfit', 'courierProfit'] as const
export type MapMetric = (typeof MAP_METRICS)[number]

export function isMoneyMetric(metric: MapMetric): boolean {
  return metric !== 'count'
}

/** 负利润（手工把司机价录得比总价高）在柱体堆叠里会让底座倒退，统一夹到 0 */
export function cellMetricValue(cell: VendorRegionCell, metric: MapMetric): number {
  const value = metric === 'count' ? cell.count : cell[metric]
  return value > 0 ? value : 0
}

export function vendorMetricValue(vendor: VendorRegionVendor, metric: MapMetric): number {
  const value = metric === 'count' ? vendor.packageCount : vendor[metric]
  return value > 0 ? value : 0
}

const moneyFormat = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})
const countFormat = new Intl.NumberFormat('en-AU')

export function formatMetricValue(value: number, metric: MapMetric): string {
  return isMoneyMetric(metric) ? moneyFormat.format(value) : countFormat.format(value)
}

export const ADELAIDE_MAP_CENTER = { lng: 138.6007, lat: -34.9285 }
export const ADELAIDE_MAP_ZOOM = 10.4

/** 各州府城市中心点，供账号按所属州自动定位地图；坐标取州府市中心 */
const REGION_MAP_CENTER: Record<string, { lng: number; lat: number }> = {
  NSW: { lng: 151.2093, lat: -33.8688 }, // 悉尼
  VIC: { lng: 144.9631, lat: -37.8136 }, // 墨尔本
  QLD: { lng: 153.0251, lat: -27.4698 }, // 布里斯班
  SA: ADELAIDE_MAP_CENTER,
  WA: { lng: 115.8605, lat: -31.9505 }, // 珀斯
  TAS: { lng: 147.3272, lat: -42.8821 }, // 霍巴特
  ACT: { lng: 149.13, lat: -35.2809 }, // 堪培拉
  NT: { lng: 130.8456, lat: -12.4634 }, // 达尔文
}

/** 账号「州/区域」→ 地图默认定位。未知/未设置州（如超管）兜底阿德莱德，与 resolveRegionTz 同一约定 */
export function resolveRegionMapCenter(regionCode: string | null | undefined): { lng: number; lat: number } {
  if (!regionCode) return ADELAIDE_MAP_CENTER
  return REGION_MAP_CENTER[regionCode] ?? ADELAIDE_MAP_CENTER
}

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

// 供应商货量趋势相关类型（VendorTrendDailyPoint / VendorTrendSupplier / VendorVolumeTrendRawResult /
// TrendGranularity 等）及聚合函数 computeTrendView 都在 shared/vendorRegionMap/trendPeriodAggregate.ts——
// 前后端共用同一份定义和实现，阈值筛选、天/周切换直接在前端本地重算，不用重新请求。
export * from '../../../shared/vendorRegionMap/trendPeriodAggregate'

/** 路由码为空的扫描归入这一行 */
export const NO_ROUTE_CODE_LABEL = '(无路由码)'
export const UNMATCHED_SUPPLIER_KEY = '__unmatched__'
/** 趋势 Tab 默认选中的折线条数：再多线就糊成一团了 */
export const TREND_DEFAULT_SELECTED_COUNT = 8
export const TREND_MAX_RANGE_DAYS = 31
