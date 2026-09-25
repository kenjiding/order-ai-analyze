import type { ZipStat } from './columnGeometry'
import { haversineKm } from './warehouseOverlay'
import type { RouteDifficultyRow } from './routeDifficulty'

export type RouteMergeParams = {
  /** 日均单量低于这个值才算「单量很少」的候选路由 */
  volumeThreshold: number
  /** 两条候选路由的代表坐标相距不超过这个距离才聚成一组 */
  clusterDistanceKm: number
  /** 一组合并后的总票量上限——避免把太多路由堆成一趟根本装不下/送不完的车 */
  maxGroupVolume: number
}

/** 无历史分布数据支撑的起点值，页面上可调，不是拍死的最终值 */
export const DEFAULT_ROUTE_MERGE_PARAMS: RouteMergeParams = {
  volumeThreshold: 60,
  clusterDistanceKm: 30,
  maxGroupVolume: 170,
}

export type RouteMergeMember = {
  supplierKey: string
  routeCode: string
  totalCount: number
  /** 理论司机利润，口径见 RouteDifficultyRow.totalCourierProfit */
  totalCourierProfit: number
  avgVolume: number
}

export type RouteMergeGroup = {
  /** 按 totalCount 降序，成员数 ≥2（没有邻居的低单量路由不会出现在任何 group 里） */
  members: RouteMergeMember[]
  totalCount: number
  /** 排序主键：合并后这一趟车总共能挣到的司机钱，不是「合并多赚的钱」——合并本身不产生新利润 */
  totalCourierProfit: number
  center: [number, number]
  /** 同一供应商自己的车队/司机才谈得上合并派送，不同供应商各自有独立的司机，不能跨供应商合并 */
  supplierKey: string
  /** 票量最大的成员路由码，UI 快速识别用 */
  representativeRouteCode: string
}

/** 路由代表坐标 = 覆盖邮编按票量加权的质心；缺坐标的邮编不计入，全部缺坐标时返回 null，不编造 */
function routeCenterFromZips(
  row: RouteDifficultyRow,
  statByZip: Map<string, ZipStat>,
): [number, number] | null {
  let lngSum = 0
  let latSum = 0
  let weightSum = 0
  for (const zip of row.zips) {
    const center = statByZip.get(zip.zipCode)?.center
    if (!center) continue
    lngSum += center[0] * zip.count
    latSum += center[1] * zip.count
    weightSum += zip.count
  }
  if (weightSum === 0) return null
  return [lngSum / weightSum, latSum / weightSum]
}

type Candidate = { row: RouteDifficultyRow; center: [number, number]; avgVolume: number }

function findRoot(parent: number[], i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]!]!
    i = parent[i]!
  }
  return i
}

/**
 * 单量很少、地理位置相近的路由码聚类成合并派送建议。
 *
 * 候选判定用日均单量（routeAvg，已剔除脏数据），不用查询区间总票量——总票量会随日期跨度漂移，
 * 阈值语义不稳定，参见 routeDifficulty.ts 里 routeAvg 的口径说明。
 *
 * 只在同一供应商内部聚类：不同供应商是各自独立的车队/司机，supplier A 的路由码不可能跟
 * supplier B 的路由码合并成一趟车，「合并派送」本质是供应商自己优化自己的司机线路。
 *
 * 聚类是「按距离从近到远、带票量容量上限」的贪心合并（Kruskal 式）：同供应商的候选两两算代表
 * 坐标距离，≤ clusterDistanceKm 的候选对按距离升序排队，离得最近的先尝试合并；每次合并前检查
 * 两组的总票量加起来会不会超过 maxGroupVolume，会就跳过这条边（两组各自留给别的候选，不因为
 * 「反正连着」就硬凑成一组）——票量上限是真实的物理约束（车装不下、司机一天送不完），触顶就
 * 决定了这一组最终停在哪。比纯 union-find（无视累计量、只要连通就无限合并）多了容量约束，比
 * k-means 之类更简单、确定性、可解释，候选量本身经过「单量很少」过滤，规模不大。
 * # ponytail: 候选路由 O(n²) 距离矩阵（按供应商分桶后每桶内比较，不是全量候选一起比），候选量
 * 若长期超过几千条会变慢，届时按经纬度分格粗筛再精确判定
 *
 * 不对合并后的利润设上限：courierProfit 是按包裹单价算的理论值，利润越高对司机越好，没有「利润
 * 太高不合适」这种物理约束（不像票量，车真的装不下）——利润只用来排序，不用来拦截合并。
 *
 * 排序按合并后总司机利润降序——这个排序回答的是「这几条各自单量太小凑不成一趟，合起来是否够格
 * 跑一趟、值不值得」，让运营先看最有价值的合并建议。
 */
export function computeRouteMergeSuggestions(
  routes: RouteDifficultyRow[],
  zipStats: ZipStat[],
  routeAvg: Map<string, number>,
  params: RouteMergeParams,
): RouteMergeGroup[] {
  const statByZip = new Map(zipStats.map((stat) => [stat.zipCode, stat]))

  const candidatesBySupplier = new Map<string, Candidate[]>()
  for (const row of routes) {
    const avgVolume = routeAvg.get(`${row.supplierKey}\0${row.routeCode}`)
    if (avgVolume == null || avgVolume >= params.volumeThreshold) continue
    const center = routeCenterFromZips(row, statByZip)
    if (center == null) continue
    const list = candidatesBySupplier.get(row.supplierKey) ?? []
    list.push({ row, center, avgVolume })
    candidatesBySupplier.set(row.supplierKey, list)
  }

  const groups: RouteMergeGroup[] = []
  for (const [supplierKey, candidates] of candidatesBySupplier) {
    const parent = candidates.map((_, i) => i)
    // 按根节点累计的总票量——union 时只更新新根这一份，查询永远只读当前根
    const groupVolume = candidates.map((c) => c.row.totalCount)

    const edges: { i: number; j: number; distanceKm: number }[] = []
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const [lngA, latA] = candidates[i]!.center
        const [lngB, latB] = candidates[j]!.center
        const distanceKm = haversineKm(latA, lngA, latB, lngB)
        if (distanceKm <= params.clusterDistanceKm) edges.push({ i, j, distanceKm })
      }
    }
    edges.sort((a, b) => a.distanceKm - b.distanceKm)

    for (const edge of edges) {
      const rootA = findRoot(parent, edge.i)
      const rootB = findRoot(parent, edge.j)
      if (rootA === rootB) continue
      const combinedVolume = groupVolume[rootA]! + groupVolume[rootB]!
      if (combinedVolume > params.maxGroupVolume) continue
      parent[rootA] = rootB
      groupVolume[rootB] = combinedVolume
    }

    const membersByRoot = new Map<number, Candidate[]>()
    candidates.forEach((candidate, i) => {
      const root = findRoot(parent, i)
      const list = membersByRoot.get(root) ?? []
      list.push(candidate)
      membersByRoot.set(root, list)
    })

    for (const members of membersByRoot.values()) {
      if (members.length < 2) continue
      const sorted = [...members].sort((a, b) => b.row.totalCount - a.row.totalCount)
      const totalCount = members.reduce((sum, m) => sum + m.row.totalCount, 0)
      const totalCourierProfit = members.reduce((sum, m) => sum + m.row.totalCourierProfit, 0)
      const center: [number, number] = [
        members.reduce((sum, m) => sum + m.center[0], 0) / members.length,
        members.reduce((sum, m) => sum + m.center[1], 0) / members.length,
      ]
      groups.push({
        members: sorted.map((m) => ({
          supplierKey: m.row.supplierKey,
          routeCode: m.row.routeCode,
          totalCount: m.row.totalCount,
          totalCourierProfit: m.row.totalCourierProfit,
          avgVolume: m.avgVolume,
        })),
        totalCount,
        totalCourierProfit,
        center,
        supplierKey,
        representativeRouteCode: sorted[0]!.row.routeCode,
      })
    }
  }

  return groups.sort((a, b) => b.totalCourierProfit - a.totalCourierProfit || b.totalCount - a.totalCount)
}
