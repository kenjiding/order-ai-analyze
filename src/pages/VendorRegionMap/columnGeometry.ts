import type { Feature, FeatureCollection, Polygon, Position } from 'geojson'
import { polygonAreaKm2, polygonCentroid } from './regionMetrics'
import {
  cellMetricValue,
  type MapMetric,
  type VendorRegionCell,
  type VendorRegionZipRegion,
} from './vendorRegionMapTypes'

const EARTH_M_PER_DEG = 111_320

/** 柱体贴地的最矮高度，保证 1 票的邮区也看得见 */
const MIN_COLUMN_M = 150
const COLUMN_SIDES = 20

/** glyph 在屏幕上的目标尺寸（像素），换算成米时乘 worldScale */
const COLUMN_RADIUS_PX = 11
const COLUMN_MAX_HEIGHT_PX = 130
/**
 * 路由码标签的环形偏移半径：固定真实米数区间，不跟 worldScale 走。
 * worldScale 是为了让柱体在缩小时屏幕像素不缩成针尖，故意把「米数」越缩小拉得越大（上限 200 m/px）；
 * 标签文字不需要这个补偿，用 worldScale 会导致缩小到 zoom 7~9 时偏移膨胀到几公里，
 * 把路由码飘到隔壁邮区，邮区对应就不准了。
 *
 * 半径本身按邮区内路由码个数自适应：固定半径下，路由码越多，相邻两个标签间的弧长越短，
 * 叠字会挡住更多文字，要缩放到很大（街道级）才能一个个分开。
 * 这里按「相邻标签间隔 ROUTE_LABEL_TARGET_ARC_M 米」反推半径，路由码多的邮区自动分得更开。
 * 900 米是按 zoom 13（常用的邮区级视角，约 15.6 m/px）反推的——两个路由码时留出约 60px 的
 * 锚点间距，字号 17px 的标签基本不会再压在一起；上限封顶，避免邮区路由码特别多时把标签甩出邮区范围。
 */
const ROUTE_LABEL_TARGET_ARC_M = 900
const ROUTE_LABEL_RADIUS_MAX_M = 650

function routeLabelRingRadiusM(total: number): number {
  if (total <= 1) return 0
  return Math.min(ROUTE_LABEL_RADIUS_MAX_M, ROUTE_LABEL_TARGET_ARC_M / (2 * Math.sin(Math.PI / total)))
}
/**
 * 下界只用来兜住街道级的极端缩放；定得太高会适得其反——glyph 在世界里被冻住尺寸，
 * 放大时就会在屏幕上无限膨胀（40 时 zoom 15 的柱子有 1100px 高）。
 * 上界则是故意的：拉到全州视野时让柱子在屏幕上缩小，否则密集处糊成一片。
 */
const WORLD_SCALE_MIN_M_PER_PX = 4
const WORLD_SCALE_MAX_M_PER_PX = 200

export function offsetLngLat(lng: number, lat: number, eastM: number, northM: number): [number, number] {
  const mPerDegLng = EARTH_M_PER_DEG * Math.cos((lat * Math.PI) / 180)
  return [lng + eastM / mPerDegLng, lat + northM / EARTH_M_PER_DEG]
}

export function regularPolygon(lng: number, lat: number, radiusM: number, sides = 24): Position[] {
  const ring: Position[] = []
  for (let i = 0; i <= sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
    ring.push(offsetLngLat(lng, lat, Math.cos(angle) * radiusM, Math.sin(angle) * radiusM))
  }
  return ring
}

/**
 * 柱体半径和最高柱由同一个 worldScale 推导，缩放时 glyph 在屏幕上大小基本恒定；
 * 不做这一步的话，固定米数的柱子在 zoom 8 是针尖、在 zoom 14 是巨柱。
 */
export function columnWorldScale(lat: number, zoom: number): number {
  const metersPerPixel = (156_543.033_92 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  return Math.min(WORLD_SCALE_MAX_M_PER_PX, Math.max(WORLD_SCALE_MIN_M_PER_PX, metersPerPixel))
}

export function columnRadiusM(worldScale: number): number {
  return COLUMN_RADIUS_PX * worldScale
}

export function columnMaxHeightM(worldScale: number): number {
  return COLUMN_MAX_HEIGHT_PX * worldScale
}

/** 平方根标度：压缩头部长尾，中小邮区重新可见。返回 0–1，供地图和图例共用同一映射 */
export function columnHeightRatio(value: number, maxValue: number): number {
  if (maxValue <= 0 || value <= 0) return 0
  return Math.sqrt(Math.min(value, maxValue) / maxValue)
}

export function columnHeightM(value: number, maxValue: number, maxHeightM: number): number {
  return MIN_COLUMN_M + columnHeightRatio(value, maxValue) * (maxHeightM - MIN_COLUMN_M)
}

function niceNumber(value: number): number {
  if (value <= 0) return 0
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  const digit = value / base
  const nice = digit >= 5 ? 5 : digit >= 2 ? 2 : 1
  return nice * base
}

/** 图例参考柱：sqrt 标度是非线性的，没有这根标尺读者无法把柱高换算回指标值 */
export function heightLegendTicks(maxValue: number): number[] {
  if (maxValue <= 0) return []
  const ticks = [maxValue, maxValue / 4, maxValue / 16]
    .map(niceNumber)
    .filter((value) => value >= 1)
  return [...new Set(ticks)].sort((a, b) => b - a)
}

/** 一个供应商在该邮区的一段，value 是当前选中指标（票量 / 供应商利润 / 司机利润）的值 */
export type ZipStatRow = { cell: VendorRegionCell; value: number }

export type ZipStat = {
  zipCode: string
  suburb: string
  /** 当前选中指标在该邮区的合计；柱高与密度都由它导出 */
  total: number
  /** 票量恒定不随指标变化，弹窗里始终显示，用来解释金额是几票算出来的 */
  packageCount: number
  /** 该邮区没匹配到区域包裹价格的票数：这些票的钱没算进 total */
  unpricedCount: number
  /** 没有 ABS 多边形时为 null，不伪造面积 */
  areaKm2: number | null
  density: number | null
  center: [number, number] | null
  polygons: Polygon[]
  rows: ZipStatRow[]
}

/** MultiPolygon 拆成多个 Polygon，fill / fill-extrusion 对各部分更稳 */
function splitPolygons(geometry: VendorRegionZipRegion['geometry']): Polygon[] {
  if (geometry.type === 'Polygon') return [geometry]
  return geometry.coordinates.map((coordinates) => ({ type: 'Polygon' as const, coordinates }))
}

/**
 * 填色层和柱体层共用同一份聚合，两层永远自洽。
 * 分组单位是「邮区+郊区」而不是邮区——邮区常覆盖好几个郊区（比如同一个邮区同时有密集住宅区和
 * 大片乡村地），按整个邮区合并的话，密度分母会被邮区里没人住的面积稀释，色块也会把没有票量的
 * 地方一起涂上色。郊区文本为空的 cell（没有 consigneeCity）自然单独成一组，退回邮区整体渲染，
 * 兼容 zipRegions 里那些没查到郊区边界、只有邮编边界的情况。
 */
export function aggregateZipStats(input: {
  cells: VendorRegionCell[]
  zipRegions: VendorRegionZipRegion[]
  metric: MapMetric
}): ZipStat[] {
  const geometryByArea = new Map<string, VendorRegionZipRegion['geometry']>()
  for (const region of input.zipRegions) geometryByArea.set(`${region.zipCode}\0${region.suburb}`, region.geometry)

  const cellsByArea = new Map<string, VendorRegionCell[]>()
  for (const cell of input.cells) {
    const areaKey = `${cell.zipCode}\0${cell.suburb}`
    const list = cellsByArea.get(areaKey) ?? []
    list.push(cell)
    cellsByArea.set(areaKey, list)
  }

  const stats: ZipStat[] = []
  for (const [areaKey, group] of cellsByArea) {
    const [zipCode, suburb] = areaKey.split('\0') as [string, string]
    const rows: ZipStatRow[] = group
      .map((cell) => ({ cell, value: cellMetricValue(cell, input.metric) }))
      .sort((a, b) => b.value - a.value || a.cell.supplierKey.localeCompare(b.cell.supplierKey))
    const total = rows.reduce((sum, row) => sum + row.value, 0)
    const packageCount = group.reduce((sum, cell) => sum + cell.count, 0)
    const unpricedCount = group.reduce((sum, cell) => sum + cell.unpricedCount, 0)
    const geometry = geometryByArea.get(areaKey)
    const polygons = geometry ? splitPolygons(geometry) : []
    const areaKm2 = geometry ? polygonAreaKm2(geometry) : null
    const geoCell = group.find((cell) => cell.lat != null && cell.lng != null)
    const center: [number, number] | null =
      geoCell?.lng != null && geoCell.lat != null
        ? [geoCell.lng, geoCell.lat]
        : geometry
          ? polygonCentroid(geometry)
          : null

    stats.push({
      zipCode,
      suburb,
      total,
      packageCount,
      unpricedCount,
      areaKm2,
      density: areaKm2 != null && areaKm2 > 0 ? total / areaKm2 : null,
      center,
      polygons,
      rows,
    })
  }
  return stats
}

/** 同一 (邮区, 郊区) 下按票量排好序的路由码，count 用于挑选碰撞时优先显示谁；supplierKey 用来给标签上色 */
export type RouteCodeLabelGroup = {
  routeCode: string
  count: number
  supplierKey: string
  /** 区域包裹价格配置里的单价，价格表没覆盖这个邮区+郊区时为 null */
  price: number | null
}

/**
 * 一个郊区级摆放点：anchor 优先用该郊区自己的质心（后端查 ABS 郊区边界算出来的），
 * 查不到时为 null，由调用方回落到邮区中心点——不能因为查不到就把这批路由码整个丢掉。
 */
export type RouteLabelArea = {
  zipCode: string
  suburb: string
  anchor: [number, number] | null
  routes: RouteCodeLabelGroup[]
}

/**
 * 路由码标签点：每个 (邮区, 郊区) 组合是独立的一个摆放点，同一郊区下只有一个路由码时直接落在
 * 郊区质心，多个则按票量降序沿环形错位摆放。以前是整个邮区共用一个点，一个邮区常覆盖好几个郊区，
 * 摆一起会让路由码明显对不上它实际服务的片区；现在按郊区分开摆，同一路由码归属不同郊区时各摆一份。
 * 具体哪个标签在低 zoom 时被挤掉，交给 MapLibre 的 symbol 碰撞避让处理，这里只负责给出候选位置。
 * 标签颜色跟柱体、填色层一样取供应商色，一眼能看出这条路由属于哪家供应商。
 */
export function buildRouteCodeLabelCollection(
  areas: RouteLabelArea[],
  colorOf: (supplierKey: string) => string,
): FeatureCollection {
  const features: Feature[] = []
  for (const area of areas) {
    if (!area.anchor || area.routes.length === 0) continue
    const total = area.routes.length
    const radiusM = routeLabelRingRadiusM(total)
    area.routes.forEach((route, index) => {
      const [lng, lat] =
        total === 1
          ? area.anchor!
          : offsetLngLat(
              area.anchor![0],
              area.anchor![1],
              radiusM * Math.cos((index / total) * Math.PI * 2 - Math.PI / 2),
              radiusM * Math.sin((index / total) * Math.PI * 2 - Math.PI / 2),
            )
      features.push({
        type: 'Feature',
        properties: {
          zipCode: area.zipCode,
          suburb: area.suburb,
          routeCode: route.routeCode,
          count: route.count,
          sortKey: -route.count,
          color: colorOf(route.supplierKey),
          price: route.price,
          priceLabel: route.price != null ? `$${route.price.toFixed(2)}` : '',
        },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      })
    })
  }
  return { type: 'FeatureCollection', features }
}

export function maxZipTotal(stats: ZipStat[]): number {
  let max = 0
  for (const stat of stats) {
    if (stat.center && stat.total > max) max = stat.total
  }
  return max
}

export function maxZipDensity(stats: ZipStat[]): number {
  let max = 0
  for (const stat of stats) {
    if (stat.density != null && stat.density > max) max = stat.density
  }
  return max
}

/** 密度未知的邮区（没有 ABS 边界面积）退回这个中性透明度，不伪造深浅 */
const REGION_FILL_OPACITY_DEFAULT = 0.5
export const REGION_FILL_OPACITY_MIN = 0.22
export const REGION_FILL_OPACITY_MAX = 0.85

/**
 * 平铺的邮区面：颜色 = 该邮区票量/金额最高的供应商（同色连片即该供应商的地盘），
 * 深浅 = 配送密度（沿用柱高同一套 sqrt 压缩，长尾不会把大多数邮区都糊成一个色阶）。
 */
export function buildRegionFillCollection(
  stats: ZipStat[],
  colorOf: (supplierKey: string) => string,
): FeatureCollection {
  const maxDensity = maxZipDensity(stats)
  const features: Feature[] = []
  for (const stat of stats) {
    const topRow = stat.rows[0]
    if (!topRow || topRow.value <= 0) continue
    const fillOpacity =
      stat.density == null
        ? REGION_FILL_OPACITY_DEFAULT
        : REGION_FILL_OPACITY_MIN +
          columnHeightRatio(stat.density, maxDensity) * (REGION_FILL_OPACITY_MAX - REGION_FILL_OPACITY_MIN)
    for (const geometry of stat.polygons) {
      features.push({
        type: 'Feature',
        properties: {
          zipCode: stat.zipCode,
          suburb: stat.suburb,
          density: stat.density,
          fillColor: colorOf(topRow.cell.supplierKey),
          fillOpacity,
        },
        geometry,
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** 等底柱：底面恒定，体积严格正比当前指标，跨邮区可直接目测对比 */
export function buildColumnCollection(
  stats: ZipStat[],
  options: { radiusM: number; maxHeightM: number; colorOf: (supplierKey: string) => string },
): FeatureCollection {
  const maxTotal = maxZipTotal(stats)
  const features: Feature[] = []

  for (const stat of stats) {
    if (!stat.center || stat.total <= 0) continue
    const geometry: Polygon = {
      type: 'Polygon',
      coordinates: [regularPolygon(stat.center[0], stat.center[1], options.radiusM, COLUMN_SIDES)],
    }
    const totalHeight = columnHeightM(stat.total, maxTotal, options.maxHeightM)

    let base = 0
    for (const { cell, value } of stat.rows) {
      if (value <= 0) continue
      const height = base + (value / stat.total) * totalHeight
      features.push({
        type: 'Feature',
        properties: {
          zipCode: stat.zipCode,
          supplierKey: cell.supplierKey,
          supplierName: cell.supplierName,
          suburb: cell.suburb,
          value,
          base,
          height,
          color: options.colorOf(cell.supplierKey),
        },
        geometry,
      })
      base = height
    }
  }

  return { type: 'FeatureCollection', features }
}
