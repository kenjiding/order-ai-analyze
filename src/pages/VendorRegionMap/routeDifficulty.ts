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
  /** 商业 POI 密度（个/km²），OSM Overpass 查不到时为 null */
  commercialDensity: number | null
  /** 公寓建筑占全部建筑的比例 0-1，OSM Overpass 查不到时为 null */
  apartmentRatio: number | null
  /** 写字楼/商铺/工业用途建筑占全部建筑的比例 0-1，OSM Overpass 查不到时为 null */
  commercialBuildingRatio: number | null
  /** 0-100，这个邮编自己的难度分（跟同批所有邮编比，不是跟路由比）；核心三项缺一就是 null */
  difficulty: number | null
  level: DifficultyLevel | 'unknown'
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
  /** 按各邮编票量加权平均的商业 POI 密度；查不到信号的邮编不计入 */
  commercialDensity: number | null
  /** 按各邮编票量加权平均的公寓占比；查不到信号的邮编不计入 */
  apartmentRatio: number | null
  /** 按各邮编票量加权平均的写字楼/商铺建筑占比；查不到信号的邮编不计入 */
  commercialBuildingRatio: number | null
  /** 0-100，越大越难派；null = 核心三项（距离/单量/密度）一个能打分的邮编都没有，不编造 */
  difficulty: number | null
  level: DifficultyLevel | 'unknown'
  /** 这条路由的距离算的是哪一级仓库坐标，UI 要标出来，不能悄悄退化 */
  warehouseSource: WarehouseSource
  /** 展开明细：同一路由码分布在哪些邮编、各多少票 */
  zips: RouteDifficultyZipDetail[]
}

/**
 * 距离/单量/密度是「这条线值不值得留司机」的经济账（跑一趟的硬成本、量大不绕路），跟
 * 商业密度/写字楼商铺/公寓衡量的「这一单好不好送」的物理账是两件事。
 *
 * 商业 POI 密度和写字楼/商铺建筑占比合并成同一个指标、共用 COMMERCIAL_WEIGHT：两者都是
 * 「这片区域有多商业化」，只是口径不同——POI 密度是跟同批查询里其他邮区比，容易被大面积
 * 边界稀释（阿德莱德 CBD 的官方郊区边界把环城公园带也算进去了，实测密度被摊薄）；建筑占比
 * 是跟自己比的绝对比例，不受批次、不受边界精度影响。两者是同一件事的两种度量，取平均互相
 * 印证比各占一个权重份额更合理——分开算反而会让其中偏低的那个把另一个已经很高的分数拉低
 * （两者本该高度相关，若其中一个因为批次/边界问题被稀释，用另一个顶上）。公寓占比衡量的是
 * 另一件独立的事（住宅楼的收件便利度），继续单独占一份权重。
 *
 * 五项权重之和为 1；若商业密度/写字楼商铺/公寓查不到信号（Overpass 没覆盖到、还没缓存上），
 * 不拿 0 分顶替，而是把对应权重份额在打分时按比例分给其余可用项（见 computeRouteDifficulty），
 * 避免一次外部数据缺失就悄悄拉低分数。
 */
/**
 * 物理账权重调回更高：距离/单量/密度（经济账）合计 0.25，商业化程度/公寓（物理账）合计
 * 0.75——商业化程度这项是「商业 POI 密度 + 写字楼/商铺建筑占比」合并后的单一指标，权重
 * 直接继承合并前两者的权重之和（0.25+0.25=0.5），公寓占比沿用原来的 0.25。
 */
const DISTANCE_WEIGHT = 0.15
const VOLUME_WEIGHT = 0.05
const DENSITY_WEIGHT = 0.05
/** 商业 POI 密度和写字楼/商铺建筑占比合用这一个权重，取两者平均（见下方注释） */
const COMMERCIAL_WEIGHT = 0.5
const APARTMENT_WEIGHT = 0.25

/** 距离封顶：地图上已有的最外圈距离圈（150km），超过一律按「最远档」算 */
const DISTANCE_CAP_KM = Math.max(...WAREHOUSE_RING_KM)

/** 打分制：0-100，分越高越难派 */
const SCORE_MAX = 100

export function difficultyLevel(score: number): DifficultyLevel {
  if (score < 20) return 'easy'
  if (score < 40) return 'fair'
  if (score < 60) return 'medium'
  if (score < 80) return 'hard'
  return 'extreme'
}

/**
 * 路由级和邮编级打分共用同一套权重/合成逻辑，区别只在输入和归一化用的「本批最大值」——
 * 路由级拿路由汇总值跟其他路由比，邮编级拿单个邮编的值跟同批所有邮编比。拆出来避免两处
 * 各写一套，权重改一次两边都生效。
 */
function scoreArea(
  input: {
    distanceKm: number | null
    count: number
    density: number | null
    commercialDensity: number | null
    apartmentRatio: number | null
    commercialBuildingRatio: number | null
  },
  maxes: { volume: number; density: number; commercialDensity: number },
): { difficulty: number | null; level: DifficultyLevel | 'unknown' } {
  if (input.distanceKm == null || input.density == null) return { difficulty: null, level: 'unknown' }

  let weightedSum =
    DISTANCE_WEIGHT * (Math.min(input.distanceKm, DISTANCE_CAP_KM) / DISTANCE_CAP_KM) +
    VOLUME_WEIGHT * (1 - columnHeightRatio(input.count, maxes.volume)) +
    DENSITY_WEIGHT * (1 - columnHeightRatio(input.density, maxes.density))
  let weightSum = DISTANCE_WEIGHT + VOLUME_WEIGHT + DENSITY_WEIGHT

  // 商业 POI 密度和写字楼/商铺建筑占比合用 COMMERCIAL_WEIGHT：两者都查得到就取平均，
  // 只查得到一个就单用那个顶上（不因为另一个缺信号就把这整项也判「不参与」）
  const commercialParts: number[] = []
  if (input.commercialDensity != null) {
    commercialParts.push(columnHeightRatio(input.commercialDensity, maxes.commercialDensity))
  }
  if (input.commercialBuildingRatio != null) commercialParts.push(input.commercialBuildingRatio)
  if (commercialParts.length > 0) {
    const commercialScore = commercialParts.reduce((sum, v) => sum + v, 0) / commercialParts.length
    weightedSum += COMMERCIAL_WEIGHT * commercialScore
    weightSum += COMMERCIAL_WEIGHT
  }
  if (input.apartmentRatio != null) {
    weightedSum += APARTMENT_WEIGHT * input.apartmentRatio
    weightSum += APARTMENT_WEIGHT
  }

  const difficulty = Math.round((weightedSum / weightSum) * SCORE_MAX)
  return { difficulty, level: difficultyLevel(difficulty) }
}

/**
 * 路由难易度 = 距仓库距离 + 单量 + 单量密度(件/km²) + (商业 POI 密度, 写字楼/商铺建筑占比)
 * + 公寓占比 的加权合成，0-100 分，分越大越难派。
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
 * 被压到 3%~5%，明明是本该有实际分量的一项却几乎不起作用，分数全靠单量/密度硬撑，评出来
 * 一大片挤在「一般」，看不出真实的难易差异。改用固定刻度后：①不会被单条离群值带偏；
 * ②同一条路由在不同日期区间查询之间分数稳定，不会因为「这次查询里有没有混进极端值」跳动；
 * ③复用地图已经在用的业务刻度，不是另起一套。
 *
 * 单量和密度沿用地图柱高同一套 sqrt 压缩（长尾分布，压掉头部让中小路由也能比出高低），且
 * 两项都是「越高越容易」（单量大/密度高 = 跑一趟能派更多件、不用绕远路，故贡献项取
 * `1 - 压缩后的比例`）。商业 POI 密度同样用 sqrt 压缩，但方向相反——商业街越密越难派
 * （停车/装卸/营业时间限制），直接取压缩后的比例，不取补数；写字楼/商铺建筑占比本身已经是
 * 0-1 的绝对比例，不需要再压缩。这两项衡量的是同一件事（这片区域有多商业化），合用一份
 * 权重，查得到的都查得到就取平均，只查得到一个就单用那个。公寓占比同样是现成的 0-1 比例，
 * 不需要压缩，直接乘权重（对讲机/等电梯/收件人难配合，占比越高越难）。
 *
 * 单量口径是查询区间内的原始总票量，不除以天数摊薄（同一次查询天数固定，摊薄对排序毫无
 * 影响，只会把展示数字缩水成误导人的「日均」）。
 *
 * 计算粒度是「supplierKey + routeCode」，不是「supplierKey + zipCode + routeCode」：
 * 同一条路由码（同一个司机线路）经常横跨好几个相邻邮编——`routes` 原始数据是按邮编拆开
 * 记的，按邮编逐行展示会把一条路由的总票量拆成好几份，人看到的只是其中一个邮编的零头
 * （例如把总共 139 票的路由拆成 47/59/33 三行，容易被误当成「统计丢单」）。这里先按
 * routeCode 把同一路由跨的所有邮编合并算总量，距离/商业密度/公寓占比取各邮编按票量加权
 * 平均，密度用总票量 / 覆盖邮编的总面积——分邮编明细放 `zips` 里供展开查看。
 *
 * density = volume / area，跟 volume 天然正相关，两者不是正交因子——但 density 额外带入了
 * 面积大小这个空间分散度信息，不是纯冗余，所以仍保留两项。
 *
 * 核心三项（距离/单量/密度）仍是硬性要求：一个能打分的邮编都没有（缺坐标或缺边界面积）
 * 就整条路由标「数据不足」，不编造——这点沿用原有口径不变。商业密度/写字楼商铺/公寓占比
 * 是后加的外部信号（OSM Overpass），查不到时不按 0 分顶替、也不让整条路由变成「数据不足」，
 * 而是把对应权重份额按比例分给其余已有的项再求和——Overpass 偶发查询失败或缓存还没填上，
 * 不该让本来已经算得出来的距离/单量/密度分数被一起拖没。
 *
 * 「未匹配供应商」（路由码对不上任何供应商配置）的包裹是发错/记错的货，根本不是一条真实
 * 常态化的司机线路，不参与难度评分——留着只会继续污染距离/单量刻度。
 */
export function computeRouteDifficulty(
  routes: VendorRegionRouteCode[],
  zipStats: ZipStat[],
  warehouseConfig: WarehouseConfig,
): RouteDifficultyRow[] {
  // 键必须带 suburb：同一邮编常覆盖好几个郊区，zipStats 是按「邮编+郊区」聚合的，
  // 只按邮编查会在多郊区邮编上随机取到其中一个郊区的面积/信号，串到另一个郊区的路由头上
  const statByArea = new Map(zipStats.map((stat) => [`${stat.zipCode}\0${stat.suburb}`, stat]))
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
        const stat = statByArea.get(`${route.zipCode}\0${route.suburb}`)
        const distanceKm =
          warehouse && stat?.center != null
            ? haversineKm(warehouse.lat, warehouse.lng, stat.center[1], stat.center[0])
            : null
        const density = stat?.areaKm2 != null && stat.areaKm2 > 0 ? route.count / stat.areaKm2 : null
        return {
          zipCode: route.zipCode,
          suburb: stat?.suburb ?? route.suburb,
          count: route.count,
          distanceKm,
          density,
          commercialDensity: stat?.commercialDensity ?? null,
          apartmentRatio: stat?.apartmentRatio ?? null,
          commercialBuildingRatio: stat?.commercialBuildingRatio ?? null,
          // 邮编级难度分在下面统一算完所有路由后再填（需要先知道同批所有邮编的最大值），
          // 这里先占位，不编造
          difficulty: null as number | null,
          level: 'unknown' as DifficultyLevel | 'unknown',
        }
      })
      .sort((a, b) => b.count - a.count || a.zipCode.localeCompare(b.zipCode))

    let distanceNumerator = 0
    let distanceDenominator = 0
    let commercialNumerator = 0
    let commercialDenominator = 0
    let apartmentNumerator = 0
    let apartmentDenominator = 0
    let commercialBuildingNumerator = 0
    let commercialBuildingDenominator = 0
    let areaSum = 0
    let hasArea = false
    for (const zip of zips) {
      if (zip.distanceKm != null) {
        distanceNumerator += zip.distanceKm * zip.count
        distanceDenominator += zip.count
      }
      if (zip.commercialDensity != null) {
        commercialNumerator += zip.commercialDensity * zip.count
        commercialDenominator += zip.count
      }
      if (zip.apartmentRatio != null) {
        apartmentNumerator += zip.apartmentRatio * zip.count
        apartmentDenominator += zip.count
      }
      if (zip.commercialBuildingRatio != null) {
        commercialBuildingNumerator += zip.commercialBuildingRatio * zip.count
        commercialBuildingDenominator += zip.count
      }
      const stat = statByArea.get(`${zip.zipCode}\0${zip.suburb}`)
      if (stat?.areaKm2 != null && stat.areaKm2 > 0) {
        areaSum += stat.areaKm2
        hasArea = true
      }
    }
    const distanceKm = distanceDenominator > 0 ? distanceNumerator / distanceDenominator : null
    const density = hasArea && areaSum > 0 ? totalCount / areaSum : null
    const commercialDensity = commercialDenominator > 0 ? commercialNumerator / commercialDenominator : null
    const apartmentRatio = apartmentDenominator > 0 ? apartmentNumerator / apartmentDenominator : null
    const commercialBuildingRatio =
      commercialBuildingDenominator > 0 ? commercialBuildingNumerator / commercialBuildingDenominator : null

    return {
      supplierKey,
      routeCode,
      totalCount,
      totalCourierProfit,
      distanceKm,
      density,
      commercialDensity,
      apartmentRatio,
      commercialBuildingRatio,
      warehouseSource,
      zips,
    }
  })

  let maxVolume = 0
  let maxDensity = 0
  let maxCommercialDensity = 0
  for (const r of raw) {
    if (r.totalCount > maxVolume) maxVolume = r.totalCount
    if (r.density != null && r.density > maxDensity) maxDensity = r.density
    if (r.commercialDensity != null && r.commercialDensity > maxCommercialDensity) {
      maxCommercialDensity = r.commercialDensity
    }
  }
  const routeMaxes = { volume: maxVolume, density: maxDensity, commercialDensity: maxCommercialDensity }

  // 邮编级难度分跟同批所有邮编比，不是跟路由比——同一批查询里，有的邮编单量大有的小，
  // 用路由级的「本批最大值」去比邮编会失真（邮编的单量永远 <= 它所在路由的总单量）
  let maxZipVolume = 0
  let maxZipDensity = 0
  let maxZipCommercialDensity = 0
  for (const r of raw) {
    for (const zip of r.zips) {
      if (zip.count > maxZipVolume) maxZipVolume = zip.count
      if (zip.density != null && zip.density > maxZipDensity) maxZipDensity = zip.density
      if (zip.commercialDensity != null && zip.commercialDensity > maxZipCommercialDensity) {
        maxZipCommercialDensity = zip.commercialDensity
      }
    }
  }
  const zipMaxes = { volume: maxZipVolume, density: maxZipDensity, commercialDensity: maxZipCommercialDensity }

  return raw.map((r) => {
    const { difficulty, level } = scoreArea(
      {
        distanceKm: r.distanceKm,
        count: r.totalCount,
        density: r.density,
        commercialDensity: r.commercialDensity,
        apartmentRatio: r.apartmentRatio,
        commercialBuildingRatio: r.commercialBuildingRatio,
      },
      routeMaxes,
    )

    const zips = r.zips.map((zip) => {
      const zipScore = scoreArea(
        {
          distanceKm: zip.distanceKm,
          count: zip.count,
          density: zip.density,
          commercialDensity: zip.commercialDensity,
          apartmentRatio: zip.apartmentRatio,
          commercialBuildingRatio: zip.commercialBuildingRatio,
        },
        zipMaxes,
      )
      return { ...zip, difficulty: zipScore.difficulty, level: zipScore.level }
    })

    return {
      supplierKey: r.supplierKey,
      routeCode: r.routeCode,
      totalCount: r.totalCount,
      totalCourierProfit: r.totalCourierProfit,
      distanceKm: r.distanceKm,
      density: r.density,
      commercialDensity: r.commercialDensity,
      apartmentRatio: r.apartmentRatio,
      commercialBuildingRatio: r.commercialBuildingRatio,
      difficulty,
      level,
      warehouseSource: r.warehouseSource,
      zips,
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
  commercialDensity: number | null
  apartmentRatio: number | null
  commercialBuildingRatio: number | null
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
    const commercialDensity = mean(
      group.map((route) => route.commercialDensity).filter((v): v is number => v != null),
    )
    const apartmentRatio = mean(group.map((route) => route.apartmentRatio).filter((v): v is number => v != null))
    const commercialBuildingRatio = mean(
      group.map((route) => route.commercialBuildingRatio).filter((v): v is number => v != null),
    )
    const difficulty = mean(group.map((route) => route.difficulty).filter((v): v is number => v != null))
    const hardRouteCount = group.filter((route) => route.level === 'hard' || route.level === 'extreme').length

    return {
      supplierKey,
      routeCount: group.length,
      totalCount,
      distanceKm,
      density,
      commercialDensity,
      apartmentRatio,
      commercialBuildingRatio,
      difficulty,
      level: difficulty == null ? 'unknown' : difficultyLevel(difficulty),
      hardRouteCount,
      routes: [...group].sort((a, b) => (b.difficulty ?? -1) - (a.difficulty ?? -1)),
    }
  })
}
