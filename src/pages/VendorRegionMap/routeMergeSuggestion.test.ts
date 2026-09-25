import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeRouteMergeSuggestions, type RouteMergeParams } from './routeMergeSuggestion'
import type { ZipStat } from './columnGeometry'
import type { RouteDifficultyRow } from './routeDifficulty'

const PARAMS: RouteMergeParams = {
  volumeThreshold: 20,
  clusterDistanceKm: 3,
  maxGroupVolume: 150,
}

function zipStat(zipCode: string, lng: number, lat: number): ZipStat {
  return {
    zipCode,
    suburb: zipCode,
    total: 0,
    packageCount: 0,
    unpricedCount: 0,
    areaKm2: null,
    density: null,
    center: [lng, lat],
    polygons: [],
    rows: [],
  }
}

function route(
  zipCode: string,
  routeCode: string,
  totalCount: number,
  totalCourierProfit: number,
  supplierKey = 'S1',
): RouteDifficultyRow {
  return {
    supplierKey,
    routeCode,
    totalCount,
    totalCourierProfit,
    distanceKm: null,
    density: null,
    difficulty: null,
    level: 'unknown',
    warehouseSource: 'none',
    zips: [{ zipCode, suburb: zipCode, count: totalCount, distanceKm: null, density: null }],
  }
}

function avgMap(entries: [string, number][]): Map<string, number> {
  return new Map(entries)
}

test('两条低单量、距离在阈值内的路由被合并成一组，票量/利润求和正确', () => {
  // 138.6 经度 1 度约 92km，0.01 度约 0.9km，两点相距约 1.3km，在 3km 阈值内
  const stats = [zipStat('A', 138.60, -34.90), zipStat('B', 138.61, -34.90)]
  const routes = [route('A', 'RA', 5, 10), route('B', 'RB', 3, 8)]
  const avg = avgMap([
    ['S1\0RA', 5],
    ['S1\0RB', 3],
  ])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.members.length, 2)
  assert.equal(groups[0]!.totalCount, 8)
  assert.equal(groups[0]!.totalCourierProfit, 18)
})

test('不同供应商的两条低单量路由即使距离很近也不合并——不同供应商是各自独立的车队', () => {
  const stats = [zipStat('A', 138.60, -34.90), zipStat('B', 138.61, -34.90)]
  const routes = [route('A', 'RA', 5, 10, 'S1'), route('B', 'RB', 3, 8, 'S2')]
  const avg = avgMap([
    ['S1\0RA', 5],
    ['S2\0RB', 3],
  ])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 0)
})

test('同一供应商的多条低单量路由各自独立聚类，group.supplierKey 就是它们共同的供应商', () => {
  const stats = [zipStat('A', 138.60, -34.90), zipStat('B', 138.61, -34.90)]
  const routes = [route('A', 'RA', 5, 10, 'S1'), route('B', 'RB', 3, 8, 'S1')]
  const avg = avgMap([
    ['S1\0RA', 5],
    ['S1\0RB', 3],
  ])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.supplierKey, 'S1')
})

test('距离超过聚类阈值的两条低单量路由不合并，各自维持独立', () => {
  const stats = [zipStat('A', 138.60, -34.90), zipStat('B', 139.60, -34.90)] // 相距约 90km，远超 3km
  const routes = [route('A', 'RA', 5, 10), route('B', 'RB', 3, 8)]
  const avg = avgMap([
    ['S1\0RA', 5],
    ['S1\0RB', 3],
  ])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 0)
})

test('单量高于阈值的路由不参与候选，即使地理位置很近也不合并', () => {
  const stats = [zipStat('A', 138.60, -34.90), zipStat('B', 138.61, -34.90)]
  const routes = [route('A', 'RA', 5, 10), route('B', 'RB', 999, 500)]
  const avg = avgMap([
    ['S1\0RA', 5],
    ['S1\0RB', 999], // 高于 volumeThreshold=20，不是候选
  ])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 0)
})

test('找不到邻居的单条低单量候选路由不出现在结果里（群组必须 ≥2）', () => {
  const stats = [zipStat('A', 138.60, -34.90)]
  const routes = [route('A', 'RA', 5, 10)]
  const avg = avgMap([['S1\0RA', 5]])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 0)
})

test('三条路由通过传递性合并成一组：A-B 达标、B-C 达标，但 A-C 直线距离超标', () => {
  // A-B 约 2.3km、B-C 约 2.3km（各自在 3km 阈值内），A-C 约 4.6km（单独看超过阈值）——
  // 验证 union-find 的传递闭包：不要求两两都直接达标，B 作为桥梁就能把 A、C 连进同一组
  const stats = [
    zipStat('A', 138.60, -34.90),
    zipStat('B', 138.625, -34.90),
    zipStat('C', 138.65, -34.90),
  ]
  const routes = [route('A', 'RA', 5, 10), route('B', 'RB', 3, 8), route('C', 'RC', 4, 6)]
  const avg = avgMap([
    ['S1\0RA', 5],
    ['S1\0RB', 3],
    ['S1\0RC', 4],
  ])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 1, 'A-B-C 应通过传递闭包合并成一组，而不是要求两两都直接达标')
  assert.equal(groups[0]!.members.length, 3)
})

test('排序按 totalCourierProfit 降序，不是按 totalCount 降序', () => {
  const stats = [
    zipStat('A', 138.60, -34.90),
    zipStat('B', 138.61, -34.90),
    zipStat('C', 139.60, -34.90),
    zipStat('D', 139.61, -34.90),
  ]
  // 簇1（A+B）票量大但利润低；簇2（C+D）票量小但利润高
  const routes = [
    route('A', 'RA', 15, 5),
    route('B', 'RB', 10, 3),
    route('C', 'RC', 2, 50),
    route('D', 'RD', 2, 40),
  ]
  const avg = avgMap([
    ['S1\0RA', 15],
    ['S1\0RB', 10],
    ['S1\0RC', 2],
    ['S1\0RD', 2],
  ])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 2)
  assert.equal(groups[0]!.totalCourierProfit, 90, '利润更高的簇（C+D）应排第一，即使票量更小')
  assert.equal(groups[1]!.totalCourierProfit, 8)
})

test('缺坐标的路由不参与候选，不报错、不编造坐标', () => {
  const noCoordStat: ZipStat = { ...zipStat('B', 0, 0), center: null }
  const stats = [zipStat('A', 138.60, -34.90), noCoordStat]
  const routes = [route('A', 'RA', 5, 10), route('B', 'RB', 3, 8)]
  const avg = avgMap([
    ['S1\0RA', 5],
    ['S1\0RB', 3],
  ])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 0, 'B 缺坐标不参与候选，A 落单也不出现在结果里')
})

test('触顶总票量上限：三条互相挨着的候选，加入第三条会超 150，第三条不并入', () => {
  const params = { ...PARAMS, maxGroupVolume: 150 }
  const stats = [
    zipStat('A', 138.600, -34.90),
    zipStat('B', 138.601, -34.90), // 离 A 最近，先尝试合并
    zipStat('C', 138.602, -34.90),
  ]
  const routes = [route('A', 'RA', 60, 10), route('B', 'RB', 60, 10), route('C', 'RC', 60, 10)]
  const avg = avgMap([
    ['S1\0RA', 5],
    ['S1\0RB', 5],
    ['S1\0RC', 5],
  ])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, params)
  assert.equal(groups.length, 1, 'A+B 先合并（120≤150），C 加入会变 180>150，被挡在外面，不应再起一组')
  assert.equal(groups[0]!.members.length, 2)
  assert.equal(groups[0]!.totalCount, 120)
  assert.ok(!groups[0]!.members.some((m) => m.routeCode === 'RC'), 'C 应该被上限挡住，没有并进这一组')
})

test('利润不设上限：三条候选票量没超上限，即使合并后利润很高也照常全部并入', () => {
  const stats = [
    zipStat('A', 138.600, -34.90),
    zipStat('B', 138.601, -34.90),
    zipStat('C', 138.602, -34.90),
  ]
  // 三条票量都很小（总量远低于 maxGroupVolume=150），但单价很高，合并后利润是天文数字——
  // 利润越高对司机越好，不该被拦下来
  const routes = [route('A', 'RA', 1, 2000), route('B', 'RB', 1, 2000), route('C', 'RC', 1, 2000)]
  const avg = avgMap([
    ['S1\0RA', 1],
    ['S1\0RB', 1],
    ['S1\0RC', 1],
  ])
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.members.length, 3, '三条都应该并进同一组，利润再高也不拦')
  assert.equal(groups[0]!.totalCourierProfit, 6000)
})

test('routeAvg 里查不到的路由（脏数据被剔除）不参与候选', () => {
  const stats = [zipStat('A', 138.60, -34.90), zipStat('B', 138.61, -34.90)]
  const routes = [route('A', 'RA', 5, 10), route('B', 'RB', 3, 8)]
  const avg = avgMap([['S1\0RA', 5]]) // RB 不在 routeAvg 里
  const groups = computeRouteMergeSuggestions(routes, stats, avg, PARAMS)
  assert.equal(groups.length, 0)
})
