import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeRouteDifficulty, computeSupplierDifficulty, type WarehouseConfig } from './routeDifficulty'
import type { ZipStat } from './columnGeometry'
import { UNMATCHED_SUPPLIER_KEY, WAREHOUSE, type VendorRegionRouteCode } from './vendorRegionMapTypes'

function zipStat(
  zipCode: string,
  offsetDeg: number,
  areaKm2: number | null,
  signal?: {
    commercialDensity?: number | null
    apartmentRatio?: number | null
    commercialBuildingRatio?: number | null
  },
): ZipStat {
  return {
    zipCode,
    suburb: zipCode,
    total: 0,
    packageCount: 0,
    unpricedCount: 0,
    areaKm2,
    density: null,
    center: [WAREHOUSE.lng + offsetDeg, WAREHOUSE.lat + offsetDeg],
    polygons: [],
    rows: [],
    commercialDensity: signal?.commercialDensity ?? null,
    apartmentRatio: signal?.apartmentRatio ?? null,
    commercialBuildingRatio: signal?.commercialBuildingRatio ?? null,
  }
}

function route(
  zipCode: string,
  routeCode: string,
  count: number,
  supplierKey = 'S1',
  deliveryStation = '',
  courierProfit = 0,
): VendorRegionRouteCode {
  return {
    zipCode,
    // zipStat() 的 suburb 约定跟 zipCode 同值；computeRouteDifficulty 按 zipCode+suburb 查 ZipStat，
    // 测试里的邮编/郊区就是一一对应的虚拟数据，保持一致才能查到
    suburb: zipCode,
    supplierKey,
    routeCode,
    count,
    deliveryStation,
    vendorProfit: 0,
    courierProfit,
    unpricedCount: 0,
  } as VendorRegionRouteCode
}

/** 默认给一个大区主仓兜底（坐标沿用旧的 WAREHOUSE 常量，保持既有用例的距离数字不变），不配任何站点 */
function warehouseConfig(overrides?: Partial<WarehouseConfig>): WarehouseConfig {
  return {
    stationCoordsByName: new Map(),
    regionWarehouse: { lat: WAREHOUSE.lat, lng: WAREHOUSE.lng },
    ...overrides,
  }
}

test('同一路由码横跨多个邮编：单量要合并成总数，不能只看某一个邮编那一份（复现 FF106 139→33 的真实 bug）', () => {
  const stats = [zipStat('5074', 0.1, 20), zipStat('5075', 0.12, 20), zipStat('5076', 0.14, 20)]
  const routes = [route('5074', 'FF106', 47), route('5075', 'FF106', 59), route('5076', 'FF106', 33)]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.totalCount, 139)
  assert.equal(rows[0]!.zips.length, 3)
  assert.equal(
    rows[0]!.zips.reduce((sum, z) => sum + z.count, 0),
    139,
  )
})

test('同一路由码跨多个邮编时，totalCourierProfit 是各邮编司机利润之和', () => {
  const stats = [zipStat('5074', 0.1, 20), zipStat('5075', 0.12, 20)]
  const routes = [
    route('5074', 'FF106', 47, 'S1', '', 30),
    route('5075', 'FF106', 59, 'S1', '', 45),
  ]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())
  assert.equal(rows[0]!.totalCourierProfit, 75)
})

test('距离越远，难度分越高（其余因子相同，且都在 150km 封顶以内）', () => {
  const stats = [zipStat('near', 0.05, 100), zipStat('far', 0.5, 100)]
  const routes = [route('near', 'R1', 100), route('far', 'R2', 100)]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())
  const near = rows.find((r) => r.routeCode === 'R1')!
  const far = rows.find((r) => r.routeCode === 'R2')!
  assert.ok(near.difficulty != null && far.difficulty != null)
  assert.ok(far.distanceKm! < 150, '这条用例本意是测封顶以内的正常远近对比')
  assert.ok(far.difficulty! > near.difficulty!)
})

test('距离按固定 150km 封顶归一化，不用「本次查询最远那条」当分母：孤立离群值不会把其他路由的距离占比带偏', () => {
  // near 明明已经不近（71km），但如果分母是「本次查询最远值」（这里是 2000+km 的离群值），
  // near 的距离占比会被压到 3% 左右——这正是要修的 bug。改成固定 150km 封顶后不会被带偏。
  const stats = [zipStat('near', 0.5, 100), zipStat('outlier', 20, 100)]
  const routes = [route('near', 'R1', 100), route('outlier', 'R2', 1)]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())
  const near = rows.find((r) => r.routeCode === 'R1')!
  assert.ok(near.distanceKm! > 60 && near.distanceKm! < 150)
  // 71km / 150km 封顶 ≈ 0.47，核心三项里距离占 0.5（商业/公寓信号缺失时权重重新分给核心三项），
  // 贡献 0.5*0.47*100 ≈ 23.5 分——远不止被离群值压到的 3%
  assert.ok(near.difficulty! > 15, `near 的距离项不该被离群值压到几乎为 0，实际 difficulty=${near.difficulty}`)
})

test('超过 150km 封顶后，再远也不会继续拉高距离项（500km 和 5000km 的距离贡献应相等）', () => {
  const stats = [zipStat('far500', 4.5, 50), zipStat('far5000', 45, 50)]
  const routes = [route('far500', 'R1', 100), route('far5000', 'R2', 100)]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())
  const a = rows.find((r) => r.routeCode === 'R1')!
  const b = rows.find((r) => r.routeCode === 'R2')!
  assert.ok(a.distanceKm! > 150 && b.distanceKm! > 150)
  assert.ok(Math.abs(a.difficulty! - b.difficulty!) < 1e-9)
})

test('未匹配供应商（发错的货）整体不参与统计和打分，也不会污染其他供应商的单量/密度归一化分母', () => {
  const stats = [zipStat('z1', 0.1, 50), zipStat('z2', 0.1, 5)]
  const routes = [
    route('z1', 'REAL', 10, 'SUP'),
    route('z2', 'JUNK', 99999, UNMATCHED_SUPPLIER_KEY),
  ]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.supplierKey, 'SUP')
  // 若未匹配供应商的 99999 票参与了 maxVolume，SUP 的 volumeRatio 会被压到接近 0，
  // 难度分会被错误地拉到很高；剔除之后 SUP 是唯一路由，volumeRatio 应为 1（因为它自己就是 max）
  assert.ok(rows[0]!.difficulty! < 50, `未匹配供应商的天量不该污染 SUP 的归一化，实际 difficulty=${rows[0]!.difficulty}`)
})

test('单量越低，难度分越高（距离、面积相同）', () => {
  const stats = [zipStat('z1', 0.1, 50)]
  const routes = [route('z1', 'HIGH', 1000), route('z1', 'LOW', 10)]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())
  const high = rows.find((r) => r.routeCode === 'HIGH')!
  const low = rows.find((r) => r.routeCode === 'LOW')!
  assert.ok(low.difficulty! > high.difficulty!)
})

test('单量不按查询区间天数摊薄：路由的总票数就是原始票数', () => {
  const stats = [zipStat('z1', 0.1, 50)]
  const routes = [route('z1', 'DD062', 42)]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())
  assert.equal(rows[0]!.totalCount, 42)
})

test('缺坐标或缺面积的邮编不参与该路由的距离/密度均值，也不撑大其他路由的归一化分母', () => {
  const stats = [zipStat('good', 0.1, 50), { ...zipStat('noArea', 0.1, null) }]
  const routes = [route('good', 'G', 50), route('noArea', 'N', 50), route('missing', 'M', 50)]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())

  const noArea = rows.find((r) => r.routeCode === 'N')!
  const missing = rows.find((r) => r.routeCode === 'M')!
  const good = rows.find((r) => r.routeCode === 'G')!
  assert.equal(noArea.level, 'unknown')
  assert.equal(noArea.difficulty, null)
  assert.equal(missing.level, 'unknown')
  assert.equal(missing.difficulty, null)
  assert.ok(good.difficulty != null)
})

test('站点坐标优先：deliveryStation 配了站点坐标时，用站点坐标算距离，不用大区主仓', () => {
  const stats = [zipStat('z1', 0.5, 50)]
  const routes = [route('z1', 'FF106', 10, 'SUP', 'ADL DS')]
  // 站点坐标就设在邮区正上方（偏移量 0），大区主仓则设在很远的地方——
  // 如果用错了坐标源，算出来的距离会天差地别，用这个差异反证走的是哪条路径
  const stationCoords = new Map([['ADL DS', { lat: WAREHOUSE.lat + 0.5, lng: WAREHOUSE.lng + 0.5 }]])
  const rows = computeRouteDifficulty(
    routes,
    stats,
    warehouseConfig({
      stationCoordsByName: stationCoords,
      regionWarehouse: { lat: WAREHOUSE.lat + 20, lng: WAREHOUSE.lng + 20 }, // 离谱远，一旦被误用距离会爆炸大
    }),
  )
  assert.equal(rows[0]!.warehouseSource, 'station')
  assert.ok(rows[0]!.distanceKm! < 5, `应该用站点坐标（近），实际 distanceKm=${rows[0]!.distanceKm}`)
})

test('站点坐标缺失时退到大区主仓，并标出 warehouseSource=region', () => {
  const stats = [zipStat('z1', 0.5, 50)]
  const routes = [route('z1', 'XX200', 10, 'SUP', 'Mount Gambier Station')] // 这个站点没配坐标
  const rows = computeRouteDifficulty(
    routes,
    stats,
    warehouseConfig({
      stationCoordsByName: new Map([['ADL DS', { lat: WAREHOUSE.lat, lng: WAREHOUSE.lng }]]), // 配了别的站点，不含这条路由用的站点
      regionWarehouse: { lat: WAREHOUSE.lat, lng: WAREHOUSE.lng },
    }),
  )
  assert.equal(rows[0]!.warehouseSource, 'region')
  assert.ok(rows[0]!.distanceKm != null)
})

test('站点坐标和大区主仓都没配时，标记数据不足，不编造距离', () => {
  const stats = [zipStat('z1', 0.5, 50)]
  const routes = [route('z1', 'XX200', 10, 'SUP', 'Nowhere Station')]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig({ regionWarehouse: null }))
  assert.equal(rows[0]!.warehouseSource, 'none')
  assert.equal(rows[0]!.distanceKm, null)
  assert.equal(rows[0]!.difficulty, null)
  assert.equal(rows[0]!.level, 'unknown')
})

test('供应商难度按路由数简单平均，不按票量加权：票量悬殊也不能让大路由把小路由的难度盖过去', () => {
  const stats = [zipStat('near', 0.05, 200), zipStat('far', 1.5, 5)]
  // EASY：近、票量巨大、密度高。HARD：远、票量极小、密度低。
  const routes = [route('near', 'EASY', 5000, 'SUP'), route('far', 'HARD', 3, 'SUP')]
  const routeRows = computeRouteDifficulty(routes, stats, warehouseConfig())
  const supplierRows = computeSupplierDifficulty(routeRows)
  const sup = supplierRows.find((s) => s.supplierKey === 'SUP')!

  const easy = routeRows.find((r) => r.routeCode === 'EASY')!
  const hard = routeRows.find((r) => r.routeCode === 'HARD')!
  // 若按票量加权，EASY（5000 票）会把 HARD（3 票）的难度压到几乎为 0；简单平均应落在两者正中间
  const expectedSimpleAvg = (easy.difficulty! + hard.difficulty!) / 2
  assert.ok(Math.abs(sup.difficulty! - expectedSimpleAvg) < 1e-9)
  assert.ok(sup.difficulty! > easy.difficulty! + 15, '简单平均不能被大票量路由的低难度分严重拉低')
})

test('供应商聚合：路由数、总票量、困难路由计数都对得上', () => {
  const stats = [zipStat('z1', 0.1, 50), zipStat('z2', 1, 5)]
  const routes = [
    route('z1', 'A', 100, 'SUP'),
    route('z2', 'B', 2, 'SUP'),
    route('z1', 'C', 999, 'OTHER'),
  ]
  const routeRows = computeRouteDifficulty(routes, stats, warehouseConfig())
  const supplierRows = computeSupplierDifficulty(routeRows)
  const sup = supplierRows.find((s) => s.supplierKey === 'SUP')!
  const other = supplierRows.find((s) => s.supplierKey === 'OTHER')!

  assert.equal(sup.routeCount, 2)
  assert.equal(sup.totalCount, 102)
  assert.equal(sup.routes.length, 2)
  assert.equal(other.routeCount, 1)
  assert.ok(sup.hardRouteCount >= 0 && sup.hardRouteCount <= sup.routeCount)
})

test('打分制：难度分落在 0-100 之间，且是整数', () => {
  const stats = [zipStat('z1', 0.3, 50)]
  const routes = [route('z1', 'R1', 100)]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())
  const score = rows[0]!.difficulty!
  assert.ok(score >= 0 && score <= 100, `应落在 0-100 之间，实际 ${score}`)
  assert.equal(score, Math.round(score))
})

test('商业街密度越高，难度分越高（距离/单量/密度/公寓占比都相同）', () => {
  const low = zipStat('low', 0.3, 50, { commercialDensity: 1, apartmentRatio: 0 })
  const high = zipStat('high', 0.3, 50, { commercialDensity: 100, apartmentRatio: 0 })
  const routes = [route('low', 'LOW', 100), route('high', 'HIGH', 100)]
  const rows = computeRouteDifficulty(routes, [low, high], warehouseConfig())
  const lowRow = rows.find((r) => r.routeCode === 'LOW')!
  const highRow = rows.find((r) => r.routeCode === 'HIGH')!
  assert.ok(highRow.difficulty! > lowRow.difficulty!, '商业街越密应该越难派，不是越容易')
})

test('公寓占比越高，难度分越高（距离/单量/密度/商业密度都相同）', () => {
  const low = zipStat('low', 0.3, 50, { commercialDensity: 0, apartmentRatio: 0.05 })
  const high = zipStat('high', 0.3, 50, { commercialDensity: 0, apartmentRatio: 0.95 })
  const routes = [route('low', 'LOW', 100), route('high', 'HIGH', 100)]
  const rows = computeRouteDifficulty(routes, [low, high], warehouseConfig())
  const lowRow = rows.find((r) => r.routeCode === 'LOW')!
  const highRow = rows.find((r) => r.routeCode === 'HIGH')!
  assert.ok(highRow.difficulty! > lowRow.difficulty!, '公寓占比越高应该越难派，不是越容易')
})

test('写字楼/商铺建筑占比越高，难度分越高（距离/单量/密度/商业密度/公寓占比都相同）', () => {
  const low = zipStat('low', 0.3, 50, { commercialDensity: 0, apartmentRatio: 0, commercialBuildingRatio: 0.05 })
  const high = zipStat('high', 0.3, 50, { commercialDensity: 0, apartmentRatio: 0, commercialBuildingRatio: 0.6 })
  const routes = [route('low', 'LOW', 100), route('high', 'HIGH', 100)]
  const rows = computeRouteDifficulty(routes, [low, high], warehouseConfig())
  const lowRow = rows.find((r) => r.routeCode === 'LOW')!
  const highRow = rows.find((r) => r.routeCode === 'HIGH')!
  assert.ok(highRow.difficulty! > lowRow.difficulty!, '写字楼/商铺建筑占比越高应该越难派，不是越容易')
})

test('回归：CBD 式路由（本批单量/密度最大、距离很近）——物理账权重调回更高（商业化程度0.5+公寓0.25=0.75）之后，分数能回升，但公寓占比偏低时仍够不到「较难」门槛', () => {
  // near 是本批单量/密度的最大值、离仓库很近（经济账三项权重只剩 0.25，贡献趋近 0 也不太伤）；
  // commercialDensity 设成本批最大值、commercialBuildingRatio 给到阿德莱德 CBD 实测区间上限
  // （~19%），两者合并取平均后喂给 COMMERCIAL_WEIGHT(0.5)；apartmentRatio=0.1（CBD 实测区间）
  // 喂给 APARTMENT_WEIGHT(0.25)——物理账权重合计 0.75，但 apartmentRatio 本身偏低，分数
  // 仍停在「一般」区间，没有冲到「较难」(60)。
  const near = zipStat('near', 0.02, 1, { commercialDensity: 500, apartmentRatio: 0.1, commercialBuildingRatio: 0.19 })
  const far = zipStat('far', 1.2, 50, { commercialDensity: 1, apartmentRatio: 0, commercialBuildingRatio: 0 })
  const routes = [route('near', 'CBD', 10000), route('far', 'RURAL', 10)]
  const rows = computeRouteDifficulty(routes, [near, far], warehouseConfig())
  const cbd = rows.find((r) => r.routeCode === 'CBD')!
  assert.ok(
    cbd.difficulty! > 25 && cbd.difficulty! < 45,
    `物理账权重调回更高后分数应该回升，但公寓占比偏低时仍到不了「较难」，实际 difficulty=${cbd.difficulty}`,
  )
})

test('每个邮编也有自己的难度分，跟同批所有邮编比，不是跟路由汇总值比', () => {
  // 同一路由码横跨两个邮编：z1 商业化程度拉满、z2 完全没有信号——两个邮编的难度分应该不同，
  // 且都不是 null（核心三项都给了有效值）
  const z1 = zipStat('z1', 0.3, 10, { commercialDensity: 500, apartmentRatio: 0.5, commercialBuildingRatio: 0.5 })
  const z2 = zipStat('z2', 0.3, 10, { commercialDensity: 1, apartmentRatio: 0, commercialBuildingRatio: 0 })
  const routes = [route('z1', 'MIX', 50), route('z2', 'MIX', 50)]
  const rows = computeRouteDifficulty(routes, [z1, z2], warehouseConfig())
  const mix = rows.find((r) => r.routeCode === 'MIX')!
  const zip1 = mix.zips.find((z) => z.zipCode === 'z1')!
  const zip2 = mix.zips.find((z) => z.zipCode === 'z2')!
  assert.ok(zip1.difficulty != null && zip2.difficulty != null, '核心三项都给了值，两个邮编都该有难度分')
  assert.ok(zip1.difficulty! > zip2.difficulty!, '商业化程度/公寓占比更高的邮编难度分应该更高')
})

test('商业街/公寓信号缺失（OSM 查不到）时不当 0 分顶替、也不让整条路由变「数据不足」：只用核心三项按比例重新打分', () => {
  const stats = [zipStat('z1', 0.3, 50)] // 不传 signal，commercialDensity/apartmentRatio 都是 null
  const routes = [route('z1', 'R1', 100)]
  const rows = computeRouteDifficulty(routes, stats, warehouseConfig())
  assert.notEqual(rows[0]!.level, 'unknown')
  assert.ok(rows[0]!.difficulty != null)
})
