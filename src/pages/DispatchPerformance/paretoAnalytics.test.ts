import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPareto } from './paretoAnalytics'
import type {
  DispatchDriverNode,
  DispatchRouteNode,
  DispatchSupplierNode,
} from './dispatchPerformanceTypes'

/** 只填排行用得到的几项，其余给零值——帕累托不看它们 */
function metrics(total: number, nextDaySignMet: number, priorityTotal = 0, priorityMet = 0) {
  return {
    total,
    before11Met: 0,
    signMet: 0,
    before11Rate: null,
    signRate: null,
    rateGap: null,
    dispatchSettled: true,
    sameDayExitMet: 0,
    sameDayExitRate: null,
    nextDaySignMet,
    nextDaySignRate: null,
    priorityTotal,
    priorityNextDaySignMet: priorityMet,
    priorityNextDaySignRate: null,
    exitMetNextDaySignMet: 0,
    priorityBefore11Met: 0,
    priorityExitMetNextDaySignMet: 0,
    problemCount: 0,
    neverSignedCount: 0,
    lateSignedCount: 0,
    vendorProfit: 0,
    courierProfit: 0,
    pricedSignedCount: 0,
    unpricedSignedCount: 0,
    quadrant: {
      exitMetSignMet: 0,
      exitMetSignUnmet: 0,
      exitUnmetSignMet: 0,
      exitUnmetSignUnmet: 0,
    },
  }
}

function driver(code: string, total: number, met: number): DispatchDriverNode {
  return {
    ...metrics(total, met),
    courierCode: code,
    courierName: `司机${code}`,
    neverSignedWaybillNos: [],
    lateSignedWaybillNos: [],
    problemWaybillNos: [],
    before11UnmetWaybillNos: [],
  }
}

function route(code: string, drivers: DispatchDriverNode[]): DispatchRouteNode {
  const total = drivers.reduce((s, d) => s + d.total, 0)
  const met = drivers.reduce((s, d) => s + d.nextDaySignMet, 0)
  return { ...metrics(total, met), routeCode: code, whitelistTotal: 0, drivers }
}

function supplier(key: string, routes: DispatchRouteNode[]): DispatchSupplierNode {
  const total = routes.reduce((s, r) => s + r.total, 0)
  const met = routes.reduce((s, r) => s + r.nextDaySignMet, 0)
  return {
    ...metrics(total, met),
    supplierKey: key,
    supplierName: key,
    vendorCode: 'V1',
    routes,
  }
}

test('按未达成单量降序，累计占比逐项累加到 100%', () => {
  const tree = [
    supplier('S1', [route('R1', [driver('C1', 100, 60), driver('C2', 100, 90)])]),
    supplier('S2', [route('R2', [driver('C3', 100, 95)])]),
  ]
  // 未达成：C1=40, C2=10, C3=5，合计 55
  const p = buildPareto(tree, 'driver', 'nextDay', 10)

  assert.deepEqual(
    p.items.map((i) => [i.label, i.unmet]),
    [['司机C1', 40], ['司机C2', 10], ['司机C3', 5]],
  )
  assert.equal(p.unmetTotal, 55)
  assert.equal(p.items[0].cumulativeShare, 72.7, '40/55')
  assert.equal(p.items.at(-1)?.cumulativeShare, 100)
  assert.equal(p.items[0].rate, 60, '达成率仍按自己的分母算')
})

test('同一个司机跑多条路由时合并成一行，而不是重复出现', () => {
  const tree = [
    supplier('S1', [
      route('R1', [driver('C1', 100, 80)]),
      route('R2', [driver('C1', 50, 30)]),
    ]),
  ]
  const p = buildPareto(tree, 'driver', 'nextDay', 10)

  assert.equal(p.items.length, 1)
  assert.equal(p.items[0].total, 150)
  assert.equal(p.items[0].unmet, 40, '20 + 20')
})

test('优先件口径换的是分母分子，不是过滤条件', () => {
  const tree = [
    supplier('S1', [
      route('R1', [{ ...driver('C1', 100, 100), priorityTotal: 10, priorityNextDaySignMet: 4 }]),
    ]),
  ]
  // 全量口径下这个司机 100% 达成、不该进排行；优先件口径下欠 6 单
  assert.deepEqual(buildPareto(tree, 'driver', 'nextDay', 10).items, [])
  const p = buildPareto(tree, 'driver', 'priority', 10)
  assert.equal(p.items[0].unmet, 6)
  assert.equal(p.items[0].total, 10)
  assert.equal(p.items[0].rate, 40)
})

test('Top 20% 集中度：项数不足 5 个时不给，够了才算', () => {
  const few = [supplier('S1', [route('R1', [driver('C1', 10, 0), driver('C2', 10, 5)])])]
  assert.equal(buildPareto(few, 'driver', 'nextDay', 10).top20Share, null)

  // 10 个司机，头一个欠 100 单，其余各欠 10 单 → Top 20%(2 个) 占 110/190
  const many = [
    supplier('S1', [
      route(
        'R1',
        [driver('C0', 100, 0), ...Array.from({ length: 9 }, (_, i) => driver(`C${i + 1}`, 10, 0))],
      ),
    ]),
  ]
  const p = buildPareto(many, 'driver', 'nextDay', 5)
  assert.equal(p.unmetTotal, 190)
  assert.equal(p.itemCount, 10, '排行只截 Top 5，集中度仍按全部 10 项算')
  assert.equal(p.items.length, 5)
  assert.equal(p.top20Share, 57.9, '110/190')
})
