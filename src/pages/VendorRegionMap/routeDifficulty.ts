import type { ZipStat } from './columnGeometry'
import { columnHeightRatio } from './columnGeometry'
import { haversineKm } from './warehouseOverlay'
import { UNMATCHED_SUPPLIER_KEY, WAREHOUSE_RING_KM, type VendorRegionRouteCode } from './vendorRegionMapTypes'

export type DifficultyLevel = 'easy' | 'fair' | 'medium' | 'hard' | 'extreme'

export type WarehouseCoords = { lat: number; lng: number }

/** 这条路由的距离用的是哪一级仓库坐标：站点(准) / 大区主仓(退化) / 都没配(不参与打分) */
export type WarehouseSource = 'station' | 'region' | 'none'

export type WarehouseConfig = {
  /** 按站点名（iMile deliveryStation 原字符串）查坐标 */
  stationCoordsByName: Map<string, WarehouseCoords>
  /** 当前账号所属大区的主仓坐标；没配则为 null */
  regionWarehouse: WarehouseCoords | null
}

function resolveRouteWarehouse(
  deliveryStation: string,
  config: WarehouseConfig,
): { coords: WarehouseCoords | null; source: WarehouseSource } {
  const byStation = deliveryStation ? config.stationCoordsByName.get(deliveryStation) : undefined
  if (byStation) return { coords: byStation, source: 'station' }
  if (config.regionWarehouse) return { coords: config.regionWarehouse, source: 'region' }
  return { coords: null, source: 'none' }
}

export type RouteDifficultyZipDetail = {
  zipCode: string
  suburb: string
  count: number
  distanceKm: number | null
  density: number | null
}

export type RouteDifficultyRow = {
  supplierKey: string
  routeCode: string
  /** 该路由码下所有邮编的票量之和 */
  totalCount: number
  /** 该路由码下所有邮编的理论司机利润之和，口径同 VendorRegionRouteCode.courierProfit */
  totalCourierProfit: number
  /** 按各邮编票量加权平均的距仓库距离；缺坐标的邮编不计入 */
  distanceKm: number | null
  /** 总票量 / 覆盖邮编的总面积（km²）；缺边界的邮编不计入面积 */
  density: number | null
  /** null = 一个能打分的邮编都没有，不编造 */
  difficulty: number | null
  level: DifficultyLevel | 'unknown'
  /** 这条路由的距离算的是哪一级仓库坐标，UI 要标出来，不能悄悄退化 */
  warehouseSource: WarehouseSource
  /** 展开明细：同一路由码分布在哪些邮编、各多少票 */
  zips: RouteDifficultyZipDetail[]
}

/** 距离权重稍高：远是司机跑一趟的硬成本，不会因为单量高就抵消 */
const DISTANCE_WEIGHT = 0.4
const VOLUME_WEIGHT = 0.3
const DENSITY_WEIGHT = 0.3

/** 距离封顶：地图上已有的最外圈距离圈（150km），超过一律按「最远档」算 */
const DISTANCE_CAP_KM = Math.max(...WAREHOUSE_RING_KM)

export function difficultyLevel(score: number): DifficultyLevel {
  if (score < 0.2) return 'easy'
  if (score < 0.4) return 'fair'
  if (score < 0.6) return 'medium'
  if (score < 0.8) return 'hard'
  return 'extreme'
}

/**
 * 路由难易度 = 距仓库距离 + 单量 + 单量密度(件/km²) 的加权合成，越大越难派。
 *
 * 距离用的「仓库」不再是全局唯一常量：大区很大时（悉尼/墨尔本），货从主仓分拨到各个小仓
 * （站点），司机从自己站点取货派送，不会跑回主仓——所以每条路由先按它的 deliveryStation
 * （到件扫描自带的派件站点，同一路由码下已验证 100% 唯一稳定）查站点坐标，查不到再退到
 * 所属大区的主仓坐标，两个都没配就不参与打分（不拿错的坐标凑数）。退化到哪一级用
 * `warehouseSource` 标出来，供 UI 提示运营去补哪个站点。
 *
 * 距离归一化用固定封顶（150km，地图上已有的最外圈距离圈），不用「本次查询里最远的那条
 * 路由」当分母——早期版本用后者，结果被一条孤立的离群值（1 票、上千公里、还是未匹配供应商
 * 的脏数据）把分母拉得极大，导致正常路由（比如真实业务里已经算远的 76km/78km）的距离占比
 * 被压到 3%~5%，明明是权重最大的一项（0.4）却几乎不起作用，分数全靠单量/密度硬撑，评出来
 * 一大片挤在「一般」，看不出真实的难易差异。改用固定刻度后：①不会被单条离群值带偏；
 * ②同一条路由在不同日期区间查询之间分数稳定，不会因为「这次查询里有没有混进极端值」跳动；
 * ③复用地图已经在用的业务刻度，不是另起一套。
 *
 * 单量和密度沿用地图柱高同一套 sqrt 压缩（长尾分布，压掉头部让中小路由也能比出高低）——
 * 这两项本来就用 sqrt 压缩过，不像线性距离那样容易被单条离群值直接打穿到接近 0，暂不用改。
 *
 * 单量口径是查询区间内的原始总票量，不除以天数摊薄（同一次查询天数固定，摊薄对排序毫无
 * 影响，只会把展示数字缩水成误导人的「日均」）。
 *
 * 计算粒度是「supplierKey + routeCode」，不是「supplierKey + zipCode + routeCode」：
 * 同一条路由码（同一个司机线路）经常横跨好几个相邻邮编——`routes` 原始数据是按邮编拆开
 * 记的，按邮编逐行展示会把一条路由的总票量拆成好几份，人看到的只是其中一个邮编的零头
 * （例如把总共 139 票的路由拆成 47/59/33 三行，容易被误当成「统计丢单」）。这里先按
 * routeCode 把同一路由跨的所有邮编合并算总量，距离取各邮编按票量加权平均，密度用
 * 总票量 / 覆盖邮编的总面积——分邮编明细放 `zips` 里供展开查看。
 *
 * density = volume / area，跟 volume 天然正相关，两者不是正交因子——但 density 额外带入了
 * 面积大小这个空间分散度信息，不是纯冗余，所以仍保留两项。
 *
 * 「未匹配供应商」（路由码对不上任何供应商配置）的包裹是发错/记错的货，根本不是一条真实
 * 常态化的司机线路，不参与难度评分——留着只会继续污染距离/单量刻度。
 */
export function computeRouteDifficulty(
  routes: VendorRegionRouteCode[],
  zipStats: ZipStat[],
  warehouseConfig: WarehouseConfig,
): RouteDifficultyRow[] {
  const statByZip = new Map(zipStats.map((stat) => [stat.zipCode, stat]))
  const matchedRoutes = routes.filter((route) => route.supplierKey !== UNMATCHED_SUPPLIER_KEY)

  const groups = new Map<string, VendorRegionRouteCode[]>()
  for (const route of matchedRoutes) {
    const key = `${route.supplierKey}\0${route.routeCode}`
    const list = groups.get(key) ?? []
    list.push(route)
    groups.set(key, list)
  }

  const raw = [...groups.entries()].map(([key, group]) => {
    const [supplierKey, routeCode] = key.split('\0') as [string, string]
    const totalCount = group.reduce((sum, route) => sum + route.count, 0)
    const totalCourierProfit = group.reduce((sum, route) => sum + route.courierProfit, 0)

    // 同一路由码下 deliveryStation 已验证唯一稳定，取第一条即可
    const { coords: warehouse, source: warehouseSource } = resolveRouteWarehouse(
      group[0]?.deliveryStation ?? '',
      warehouseConfig,
    )

    const zips: RouteDifficultyZipDetail[] = group
      .map((route) => {
        const stat = statByZip.get(route.zipCode)
        const distanceKm =
          warehouse && stat?.center != null
            ? haversineKm(warehouse.lat, warehouse.lng, stat.center[1], stat.center[0])
            : null
        const density = stat?.areaKm2 != null && stat.areaKm2 > 0 ? route.count / stat.areaKm2 : null
        return { zipCode: route.zipCode, suburb: stat?.suburb ?? '', count: route.count, distanceKm, density }
      })
      .sort((a, b) => b.count - a.count || a.zipCode.localeCompare(b.zipCode))

    let distanceNumerator = 0
    let distanceDenominator = 0
    let areaSum = 0
    let hasArea = false
    for (const zip of zips) {
      if (zip.distanceKm != null) {
        distanceNumerator += zip.distanceKm * zip.count
        distanceDenominator += zip.count
      }
      const stat = statByZip.get(zip.zipCode)
      if (stat?.areaKm2 != null && stat.areaKm2 > 0) {
        areaSum += stat.areaKm2
        hasArea = true
      }
    }
    const distanceKm = distanceDenominator > 0 ? distanceNumerator / distanceDenominator : null
    const density = hasArea && areaSum > 0 ? totalCount / areaSum : null

    return { supplierKey, routeCode, totalCount, totalCourierProfit, distanceKm, density, warehouseSource, zips }
  })

  let maxVolume = 0
  let maxDensity = 0
  for (const r of raw) {
    if (r.totalCount > maxVolume) maxVolume = r.totalCount
    if (r.density != null && r.density > maxDensity) maxDensity = r.density
  }

  return raw.map((r) => {
    const scorable = r.distanceKm != null && r.density != null
    const difficulty = scorable
      ? DISTANCE_WEIGHT * (Math.min(r.distanceKm!, DISTANCE_CAP_KM) / DISTANCE_CAP_KM) +
        VOLUME_WEIGHT * (1 - columnHeightRatio(r.totalCount, maxVolume)) +
        DENSITY_WEIGHT * (1 - columnHeightRatio(r.density!, maxDensity))
      : null

    return {
      supplierKey: r.supplierKey,
      routeCode: r.routeCode,
      totalCount: r.totalCount,
      totalCourierProfit: r.totalCourierProfit,
      distanceKm: r.distanceKm,
      density: r.density,
      difficulty,
      level: difficulty == null ? 'unknown' : difficultyLevel(difficulty),
      warehouseSource: r.warehouseSource,
      zips: r.zips,
    }
  })
}

export type SupplierDifficultyRow = {
  supplierKey: string
  routeCount: number
  /** 供应商名下所有路由票量之和，仅作体量参考，不参与打分 */
  totalCount: number
  distanceKm: number | null
  density: number | null
  difficulty: number | null
  level: DifficultyLevel | 'unknown'
  /** 难度等级为「较难/极难」的路由数：均值不高也可能藏着几条难啃的路由，需要单独看 */
  hardRouteCount: number
  /** 展开明细：按难度分降序排列 */
  routes: RouteDifficultyRow[]
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * 供应商难度 = 该供应商名下所有路由码难度分的**简单平均**，不按票量加权。
 *
 * 「一条路由码 ≈ 一条司机线路」（同一口径见 `RouteCodeVolumeHeatmap.tsx` 的注释），供应商
 * 层面的「难易度」问的是「这个供应商有多少条线难招/难留司机」，不是「平均每件包裹有多难
 * 送」——按票量加权会把票量小但又远又稀的路由（恰恰是最难留住司机的那种）在总分里边缘化，
 * 反而背离了这个指标本来要发现的问题。所以这里给每条路由码相同的权重，距离、密度同理做
 * 简单平均；总票量单独展示作为体量参考，不参与打分。
 *
 * 只对有难度分的路由取平均（缺坐标/缺边界的路由不参与，也不当 0 分处理）；一个能打分的
 * 路由都没有时供应商难度也是「数据不足」，不编造。
 */
export function computeSupplierDifficulty(routes: RouteDifficultyRow[]): SupplierDifficultyRow[] {
  const bySupplier = new Map<string, RouteDifficultyRow[]>()
  for (const route of routes) {
    const list = bySupplier.get(route.supplierKey) ?? []
    list.push(route)
    bySupplier.set(route.supplierKey, list)
  }

  return [...bySupplier.entries()].map(([supplierKey, group]) => {
    const totalCount = group.reduce((sum, route) => sum + route.totalCount, 0)
    const distanceKm = mean(group.map((route) => route.distanceKm).filter((v): v is number => v != null))
    const density = mean(group.map((route) => route.density).filter((v): v is number => v != null))
    const difficulty = mean(group.map((route) => route.difficulty).filter((v): v is number => v != null))
    const hardRouteCount = group.filter((route) => route.level === 'hard' || route.level === 'extreme').length

    return {
      supplierKey,
      routeCount: group.length,
      totalCount,
      distanceKm,
      density,
      difficulty,
      level: difficulty == null ? 'unknown' : difficultyLevel(difficulty),
      hardRouteCount,
      routes: [...group].sort((a, b) => (b.difficulty ?? -1) - (a.difficulty ?? -1)),
    }
  })
}
