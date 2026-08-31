/**
 * 白名单口径的回归线：路由码/司机两层看得见白名单，供应商行与站点汇总不把它算进率。
 * 这两条走的是同一份格子，很容易在改累加时被一起改掉，所以单独钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDispatchPerformanceTree,
  type DispatchPerformanceStatRow,
} from './repository'

/** 一格：默认已结算、全部达标，用 overrides 表达要测的那一维 */
function cell(over: Partial<DispatchPerformanceStatRow> = {}): DispatchPerformanceStatRow {
  return {
    arrivalDate: '2024-06-24',
    supplierKey: 'V1::ADL-Lu',
    supplierName: 'ADL-Lu',
    vendorCode: 'V1',
    routeCode: 'R1',
    courierCode: 'C1',
    courierName: 'D1',
    isWhitelist: false,
    dispatchSettled: true,
    total: 0,
    before11Met: 0,
    exitMetSignMet: 0,
    exitMetSignUnmet: 0,
    exitUnmetSignMet: 0,
    exitUnmetSignUnmet: 0,
    problemCount: 0,
    neverSignedCount: 0,
    lateSignedCount: 0,
    neverSignedWaybillNos: [],
    lateSignedWaybillNos: [],
    problemWaybillNos: [],
    before11UnmetWaybillNos: [],
    ...over,
  }
}

/** 全达标的一格 */
function met(over: Partial<DispatchPerformanceStatRow>): DispatchPerformanceStatRow {
  const total = over.total ?? 0
  return cell({ ...over, before11Met: total, exitMetSignMet: total })
}

/** 全未达标的一格 */
function unmet(over: Partial<DispatchPerformanceStatRow>): DispatchPerformanceStatRow {
  const total = over.total ?? 0
  return cell({ ...over, before11Met: 0, exitUnmetSignUnmet: total, neverSignedCount: total })
}

test('白名单：路由层照常出指标，供应商行与站点汇总都不计入', () => {
  const tree = buildDispatchPerformanceTree([
    met({ routeCode: 'R1', total: 90 }),
    // 白名单路由全军覆没，但一分都不该拉低供应商的率
    unmet({ routeCode: 'R9', total: 10, isWhitelist: true }),
  ])

  const [supplier] = tree.suppliers
  assert.equal(supplier.total, 90, '供应商 total 不含白名单')
  assert.equal(supplier.before11Rate, 100, '白名单的 10 单未达标没有拉低出仓率')
  assert.equal(supplier.signRate, 100)
  assert.equal(supplier.whitelistTotal, 10, '差额显式给出，解释展开后为什么对不上')
  assert.equal(tree.overall.total, 90)
  assert.equal(tree.overall.before11Rate, 100)
  assert.equal(tree.whitelistTotal, 10)

  // 但白名单路由本身必须看得见，且指标按同一口径算
  const routes = new Map(supplier.routes.map((r) => [r.routeCode, r]))
  assert.equal(routes.size, 2)
  const r9 = routes.get('R9')
  assert.equal(r9?.total, 10)
  assert.equal(r9?.before11Rate, 0)
  assert.equal(r9?.signRate, 0)
  assert.equal(r9?.whitelistTotal, 10, '整条路由都不计入')
  assert.equal(routes.get('R1')?.whitelistTotal, 0)

  // 展开后各路由之和 - 供应商 total = whitelistTotal
  const routeSum = supplier.routes.reduce((n, r) => n + r.total, 0)
  assert.equal(routeSum - supplier.total, supplier.whitelistTotal)
})

test('整条不考核的路由排到末尾，不占「最差那几条」的位置', () => {
  const tree = buildDispatchPerformanceTree([
    unmet({ routeCode: 'W', total: 50, isWhitelist: true }),
    unmet({ routeCode: 'R2', total: 5 }),
    met({ routeCode: 'R1', total: 20 }),
  ])
  assert.deepEqual(
    tree.suppliers[0].routes.map((r) => r.routeCode),
    ['R2', 'R1', 'W'],
  )
})

test('区间内中途加进白名单：按天分别计，路由上标出只有部分不计入', () => {
  const tree = buildDispatchPerformanceTree([
    // 24 号还在考核
    unmet({ arrivalDate: '2024-06-24', routeCode: 'R3', total: 4 }),
    // 25 号起进了白名单
    unmet({ arrivalDate: '2024-06-25', routeCode: 'R3', total: 6, isWhitelist: true }),
  ])

  const [supplier] = tree.suppliers
  assert.equal(supplier.total, 4, '只有改配置之前那天计入考核')
  assert.equal(supplier.whitelistTotal, 6)

  const [route] = supplier.routes
  assert.equal(route.total, 10, '路由层看到的是这条路由的全部单量')
  assert.equal(route.whitelistTotal, 6, '布尔标记在这里会忽真忽假，所以记数量')
})

test('司机层：白名单路由下的司机照常出指标与运单号', () => {
  const tree = buildDispatchPerformanceTree([
    cell({
      routeCode: 'R9',
      isWhitelist: true,
      courierCode: 'C9',
      courierName: 'D9',
      total: 2,
      exitUnmetSignUnmet: 2,
      neverSignedCount: 2,
      neverSignedWaybillNos: ['W1', 'W2'],
    }),
  ])
  const [driver] = tree.suppliers[0].routes[0].drivers
  assert.equal(driver.courierCode, 'C9')
  assert.equal(driver.total, 2)
  assert.equal(driver.signRate, 0)
  assert.deepEqual(driver.neverSignedWaybillNos, ['W1', 'W2'])
})
