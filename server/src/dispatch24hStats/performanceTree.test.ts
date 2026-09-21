/**
 * 白名单口径的回归线：同一份格子跑两个口径 —— 剔除白名单时它整格不参与统计，
 * 全量时它照常参与。两边都要自洽（四层加得起来），很容易在改累加时被一起改坏，所以单独钉住。
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
    sameDayExitMet: 0,
    exitMetNextDaySignMet: 0,
    priorityBefore11Met: 0,
    priorityExitMetNextDaySignMet: 0,
    nextDaySignMet: 0,
    priorityTotal: 0,
    priorityNextDaySignMet: 0,
    problemCount: 0,
    neverSignedCount: 0,
    lateSignedCount: 0,
    vendorProfit: 0,
    courierProfit: 0,
    pricedSignedCount: 0,
    unpricedSignedCount: 0,
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

test('剔除白名单口径（默认）：白名单格子整格不参与统计，四层都看不到它', () => {
  const tree = buildDispatchPerformanceTree([
    met({ routeCode: 'R1', total: 90 }),
    // 白名单路由全军覆没，但一分都不该拉低供应商的率
    unmet({ routeCode: 'R9', total: 10, isWhitelist: true }),
  ])

  const [supplier] = tree.suppliers
  assert.equal(supplier.total, 90, '供应商 total 不含白名单')
  assert.equal(supplier.before11Rate, 100, '白名单的 10 单未达标没有拉低出仓率')
  assert.equal(supplier.signRate, 100)
  assert.equal(tree.overall.total, 90)
  assert.equal(tree.overall.before11Rate, 100)
  assert.equal(tree.whitelistTotal, 10, '剔掉了多少单要显式报出来')

  // 剔除口径下白名单路由整条不存在 —— 不是「显示但不计入」，是压根不在结果里
  assert.deepEqual(
    supplier.routes.map((r) => r.routeCode),
    ['R1'],
  )
  // 口径内部自洽：展开后各路由之和 = 供应商行
  assert.equal(
    supplier.routes.reduce((n, r) => n + r.total, 0),
    supplier.total,
  )
})

test('全量口径：白名单格子照常参与统计，率被它拉低，路由上仍标出它是白名单', () => {
  const rows = [
    met({ routeCode: 'R1', total: 90 }),
    unmet({ routeCode: 'R9', total: 10, isWhitelist: true }),
  ]
  const tree = buildDispatchPerformanceTree(rows, true)

  const [supplier] = tree.suppliers
  assert.equal(supplier.total, 100, '全量口径下白名单单量算进来')
  assert.equal(supplier.before11Rate, 90, '10 单未达标如实拉低出仓率')
  assert.equal(supplier.signRate, 90)
  assert.equal(tree.overall.total, 100)
  assert.equal(tree.whitelistTotal, 10, '全量口径下它表示「其中含多少单白名单」')

  const routes = new Map(supplier.routes.map((r) => [r.routeCode, r]))
  assert.equal(routes.size, 2)
  assert.equal(routes.get('R9')?.total, 10)
  assert.equal(routes.get('R9')?.whitelistTotal, 10, '标记还在，用户要知道这条本不考核')
  assert.equal(routes.get('R1')?.whitelistTotal, 0)
  assert.equal(
    supplier.routes.reduce((n, r) => n + r.total, 0),
    supplier.total,
    '全量口径同样自洽：路由之和 = 供应商行',
  )
})

test('区间内中途加进白名单：按天分别计，两个口径各取各的那部分', () => {
  const rows = [
    // 24 号还在考核
    unmet({ arrivalDate: '2024-06-24', routeCode: 'R3', total: 4 }),
    // 25 号起进了白名单
    unmet({ arrivalDate: '2024-06-25', routeCode: 'R3', total: 6, isWhitelist: true }),
  ]

  const excluded = buildDispatchPerformanceTree(rows)
  assert.equal(excluded.suppliers[0].total, 4, '只有改配置之前那天计入')
  assert.equal(excluded.suppliers[0].routes[0].total, 4, '同一条路由只留下没进白名单的那天')
  assert.equal(excluded.whitelistTotal, 6)

  const all = buildDispatchPerformanceTree(rows, true)
  assert.equal(all.suppliers[0].total, 10)
  const [route] = all.suppliers[0].routes
  assert.equal(route.total, 10)
  assert.equal(route.whitelistTotal, 6, '布尔标记在这里会忽真忽假，所以记数量')
})

test('司机层：全量口径下白名单路由的司机照常出指标与运单号', () => {
  const tree = buildDispatchPerformanceTree(
    [
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
    ],
    true,
  )
  const [driver] = tree.suppliers[0].routes[0].drivers
  assert.equal(driver.courierCode, 'C9')
  assert.equal(driver.total, 2)
  assert.equal(driver.signRate, 0)
  assert.deepEqual(driver.neverSignedWaybillNos, ['W1', 'W2'])
})

test('次日指标：已结算按计数出率，混进未结算的一天则次日两个率为 null、当天出仓率照常', () => {
  const settled = cell({
    arrivalDate: '2024-06-24',
    total: 10,
    sameDayExitMet: 4,
    nextDaySignMet: 8,
    priorityTotal: 2,
    priorityNextDaySignMet: 1,
  })
  const tree = buildDispatchPerformanceTree([settled])
  assert.equal(tree.overall.sameDayExitRate, 40)
  assert.equal(tree.overall.nextDaySignRate, 80)
  assert.equal(tree.overall.priorityNextDaySignRate, 50)

  const mixed = buildDispatchPerformanceTree([
    settled,
    cell({ arrivalDate: '2024-06-25', total: 10, sameDayExitMet: 6, priorityTotal: 3, dispatchSettled: false }),
  ])
  assert.equal(mixed.overall.sameDayExitRate, 50)
  assert.equal(mixed.overall.priorityTotal, 5)
  assert.equal(mixed.overall.nextDaySignRate, null)
  assert.equal(mixed.overall.priorityNextDaySignRate, null)
})

test('优先件跟着口径走：剔除口径下不含白名单的优先件，全量口径下含', () => {
  const rows = [
    met({ routeCode: 'R1', total: 90, priorityTotal: 234, priorityNextDaySignMet: 200 }),
    unmet({ routeCode: 'AA018', total: 10, isWhitelist: true, priorityTotal: 4, priorityNextDaySignMet: 1 }),
  ]

  const excluded = buildDispatchPerformanceTree(rows)
  assert.equal(excluded.suppliers[0].priorityTotal, 234, '白名单那 4 单优先件不计入')
  assert.equal(excluded.suppliers[0].priorityNextDaySignMet, 200)
  assert.equal(excluded.overall.priorityTotal, 234)

  const all = buildDispatchPerformanceTree(rows, true)
  assert.equal(all.suppliers[0].priorityTotal, 238, '234 + 白名单 4')
  assert.equal(all.suppliers[0].priorityNextDaySignMet, 201)
  assert.equal(all.suppliers[0].priorityNextDaySignRate, 84.45, '201 / 238')
  assert.equal(all.overall.priorityTotal, 238)

  // 两个口径下路由行加起来都等于供应商行
  for (const tree of [excluded, all]) {
    const [supplier] = tree.suppliers
    assert.equal(
      supplier.routes.reduce((n, r) => n + r.priorityTotal, 0),
      supplier.priorityTotal,
    )
  }
})

test('利润跟着口径走：剔除口径下不含白名单的钱，全量口径下含，三层始终加总一致', () => {
  const rows = [
    met({ routeCode: 'R1', courierCode: 'C1', total: 10, vendorProfit: 2.5, courierProfit: 24.5, pricedSignedCount: 10 }),
    met({ routeCode: 'R1', courierCode: 'C2', total: 20, vendorProfit: 5, courierProfit: 49, pricedSignedCount: 18, unpricedSignedCount: 2 }),
    met({ routeCode: 'R9', courierCode: 'C3', total: 5, vendorProfit: 1.25, courierProfit: 12.25, pricedSignedCount: 5, isWhitelist: true }),
  ]

  const excluded = buildDispatchPerformanceTree(rows)
  assert.equal(excluded.suppliers[0].total, 30)
  assert.equal(excluded.suppliers[0].vendorProfit, 7.5, '白名单那 1.25 不计入')
  assert.equal(excluded.suppliers[0].pricedSignedCount, 28)
  assert.equal(excluded.whitelistTotal, 5)

  const all = buildDispatchPerformanceTree(rows, true)
  const [supplier] = all.suppliers
  assert.equal(supplier.total, 35)
  assert.equal(supplier.vendorProfit, 8.75, '全量口径下白名单的 1.25 算进来')
  assert.equal(supplier.courierProfit, 85.75)
  assert.equal(supplier.pricedSignedCount, 33)
  assert.equal(supplier.unpricedSignedCount, 2)
  assert.equal(all.overall.vendorProfit, 8.75)

  const routes = new Map(supplier.routes.map((r) => [r.routeCode, r]))
  assert.equal(routes.get('R1')?.vendorProfit, 7.5)
  assert.equal(routes.get('R9')?.vendorProfit, 1.25, '白名单路由自己那行照常看得见金额')

  // 司机行加总 = 路由行
  const drivers = routes.get('R1')?.drivers ?? []
  assert.equal(
    drivers.reduce((n, d) => n + (d.courierProfit ?? 0), 0),
    routes.get('R1')?.courierProfit,
  )
})

test('利润：区间混进未结算日时仍给出已结算部分的钱，不整段抹成 null', () => {
  const tree = buildDispatchPerformanceTree([
    met({ arrivalDate: '2024-06-24', routeCode: 'R1', total: 10, vendorProfit: 2.5, courierProfit: 24.5 }),
    // 未结算日：金额本就是 0（出仓趟不算钱），累加不会污染已结算那天的数
    cell({ arrivalDate: '2024-06-25', routeCode: 'R1', total: 10, before11Met: 10, dispatchSettled: false }),
  ])

  const [supplier] = tree.suppliers
  assert.equal(supplier.dispatchSettled, false, '区间不完整这件事仍要如实报出来')
  assert.equal(supplier.signRate, null, '率照旧给 null：比例混了未结算日就没意义')
  assert.equal(supplier.vendorProfit, 2.5, '钱是可加的，已结算那天赚的必须看得见')
  assert.equal(supplier.courierProfit, 24.5)
  assert.equal(supplier.before11Rate, 100, '出仓率不受影响，它出仓那趟就定死了')
})
