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
