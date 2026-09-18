import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUS_TZ, localDateTimeToMs } from '../imile/ausTimezone'
import {
  aggregateDispatch24hByScopes,
  dispatchExitThresholdMs,
  resolveDispatch24hWindowRule,
  resolveExitDate,
  type Dispatch24hScope,
  type Dispatch24hWaybillRow,
} from '../vendorAnalysis/dispatch24hAggregate'
import {
  aggregateDispatchPerformanceCells,
  priceBookKey,
  type DispatchPerformanceCell,
  type PackagePrice,
} from './aggregateCells'

const tz = AUS_TZ.Adelaide
// 到件日 2024-06-24（周一）→ 出仓日周二 06-25，出仓阈值 06-25 11:00，派签窗口滚动 24h
const ARRIVAL = '2024-06-24'
const rule = resolveDispatch24hWindowRule(ARRIVAL, tz)
const threshold = dispatchExitThresholdMs(ARRIVAL, tz)
const sameDayThreshold = localDateTimeToMs(`${ARRIVAL} 23:59:59`, tz)
const nextDayDeadline = localDateTimeToMs(`${resolveExitDate(ARRIVAL)} 23:59:59`, tz)
const priorityClientCodes = new Set(['P1'])

function scope(
  key: string,
  vendorCode: string,
  routeCodes?: string[],
  whitelist?: string[],
): Dispatch24hScope {
  return {
    key,
    vendorCode,
    routeCodes: routeCodes ? new Set(routeCodes) : undefined,
    routeCodeWhitelist: whitelist ? new Set(whitelist) : undefined,
  }
}

/** 派签趟（D+2）：完整结算 */
function run(
  rows: Dispatch24hWaybillRow[],
  scopes: Dispatch24hScope[],
  priceBook?: Map<string, PackagePrice>,
): DispatchPerformanceCell[] {
  return aggregateDispatchPerformanceCells({
    rows,
    stationCodes: ['S1'],
    rule,
    before11ThresholdMs: threshold,
    sameDayExitThresholdMs: sameDayThreshold,
    nextDayDeadlineMs: nextDayDeadline,
    scopes,
    priorityClientCodes,
    priceBook,
  })
}

/** 出仓趟（D+1）：rule=null，只结算出仓 */
function runExitOnly(
  rows: Dispatch24hWaybillRow[],
  scopes: Dispatch24hScope[],
  priceBook?: Map<string, PackagePrice>,
): DispatchPerformanceCell[] {
  return aggregateDispatchPerformanceCells({
    rows,
    stationCodes: ['S1'],
    rule: null,
    before11ThresholdMs: threshold,
    sameDayExitThresholdMs: sameDayThreshold,
    nextDayDeadlineMs: nextDayDeadline,
    scopes,
    priorityClientCodes,
    priceBook,
  })
}

const base = { courierVendorCode: 'V1', lastScanSiteCode: 'S1' }

test('四象限：按「是否11点前出仓 × 是否24h达标」正确归类，四者之和恒等于 total', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // 09:00 出仓（≤11:00）+ 当天签收 → 出仓达标、派签达标
    { ...base, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    // 09:00 出仓 + 超 24h 才签收 → 出仓达标、派签未达标（司机侧）
    { ...base, waybillNo: 'B', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-26 10:00:00' },
    // 13:00 出仓（晚于阈值）+ 窗口内签收 → 出仓未达标、派签达标（赶回来了）
    { ...base, waybillNo: 'C', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 13:00:00', signDate: '2024-06-25 20:00:00' },
    // 13:00 出仓 + 从未签收 → 双未达标（连锁失败）
    { ...base, waybillNo: 'D', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 13:00:00' },
  ]
  const [cell] = run(rows, [scope('U1', 'V1')])

  assert.equal(cell.total, 4)
  assert.equal(cell.exitMetSignMet, 1)
  assert.equal(cell.exitMetSignUnmet, 1)
  assert.equal(cell.exitUnmetSignMet, 1)
  assert.equal(cell.exitUnmetSignUnmet, 1)
  assert.equal(
    cell.exitMetSignMet + cell.exitMetSignUnmet + cell.exitUnmetSignMet + cell.exitUnmetSignUnmet,
    cell.total,
  )
  assert.deepEqual(cell.before11UnmetWaybillNos, ['C', 'D'])
  assert.deepEqual(cell.lateSignedWaybillNos, ['B'])
  assert.deepEqual(cell.neverSignedWaybillNos, ['D'])

  // 派签结算后，单独存的 before11Met 必须与四象限反推的一致
  assert.equal(cell.dispatchSettled, true)
  assert.equal(cell.before11Met, cell.exitMetSignMet + cell.exitMetSignUnmet)
})

test('出仓趟：只算出仓，派签相关列一律留空并标记未结算', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { ...base, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    { ...base, waybillNo: 'B', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 13:00:00' },
  ]
  const [cell] = runExitOnly(rows, [scope('U1', 'V1')])

  assert.equal(cell.dispatchSettled, false)
  assert.equal(cell.total, 2)
  assert.equal(cell.before11Met, 1, '09:00 出仓达标，13:00 未达标')
  assert.deepEqual(cell.before11UnmetWaybillNos, ['B'])

  // 关键：A 其实已签收，但这一趟绝不能把它算成派签达标——窗口还没到期，
  // 包裹可能被归班盘点重新派出，此刻的结论不作数
  assert.equal(cell.exitMetSignMet, 0)
  assert.equal(cell.exitMetSignUnmet, 0)
  assert.equal(cell.exitUnmetSignMet, 0)
  assert.equal(cell.exitUnmetSignUnmet, 0)
  assert.equal(cell.neverSignedCount, 0)
  assert.equal(cell.lateSignedCount, 0)
  assert.equal(cell.problemCount, 0)
})

test('两趟的出仓结论一致：出仓趟先写的 before11Met，派签趟重算后不变', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { ...base, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    { ...base, waybillNo: 'B', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 13:00:00', signDate: '2024-06-26 20:00:00' },
    { ...base, waybillNo: 'C', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 10:30:00' },
  ]
  const [exitPass] = runExitOnly(rows, [scope('U1', 'V1')])
  const [dispatchPass] = run(rows, [scope('U1', 'V1')])

  assert.equal(exitPass.total, dispatchPass.total)
  assert.equal(exitPass.before11Met, dispatchPass.before11Met)
  assert.deepEqual(exitPass.before11UnmetWaybillNos, dispatchPass.before11UnmetWaybillNos)
})

test('未派件的单：出仓与派签都记未达标，归入空司机码，司机行加总仍等于供应商总数', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { ...base, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    // 尚未派件：无 deliveryTime、无 courierCode
    { ...base, waybillNo: 'N1', consigneeRouteCode: 'R1' },
    { ...base, waybillNo: 'N2', consigneeRouteCode: 'R1' },
  ]
  const cells = run(rows, [scope('U1', 'V1')])

  const noCourier = cells.find((c) => c.courierCode === '')
  assert.ok(noCourier)
  assert.equal(noCourier.total, 2)
  assert.equal(noCourier.exitUnmetSignUnmet, 2)

  const supplierTotal = cells.reduce((sum, c) => sum + c.total, 0)
  assert.equal(supplierTotal, 3)
})

test('路由码维度：同一供应商下不同路由码各自成格，同一路由码下不同司机再拆一层', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { ...base, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    { ...base, waybillNo: 'B', courierCode: 'C2', courier: 'D2', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    { ...base, waybillNo: 'C', courierCode: 'C3', courier: 'D3', consigneeRouteCode: 'R2', deliveryTime: '2024-06-25 13:00:00' },
  ]
  const cells = run(rows, [scope('U1', 'V1')])
  assert.equal(cells.length, 3)

  const byRoute = new Map<string, number>()
  for (const c of cells) byRoute.set(c.routeCode, (byRoute.get(c.routeCode) ?? 0) + c.total)
  assert.equal(byRoute.get('R1'), 2)
  assert.equal(byRoute.get('R2'), 1)

  const r1Drivers = cells.filter((c) => c.routeCode === 'R1').map((c) => c.courierCode).sort()
  assert.deepEqual(r1Drivers, ['C1', 'C2'])
})

test('一个路由码归属两家供应商时各自独立计入，不是互斥归属', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // 承运商未回填，靠路由码兜底归属：R9 同时配在两家
    { waybillNo: 'S', lastScanSiteCode: 'S1', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R9', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
  ]
  const cells = run(rows, [scope('U1', 'V1', ['R9']), scope('U2', 'V2', ['R9'])])
  assert.deepEqual(cells.map((c) => c.scopeKey).sort(), ['U1', 'U2'])
  for (const c of cells) assert.equal(c.total, 1)
})

test('与告警侧 aggregateDispatch24hByScopes 口径一致：达标数、问题件数逐 scope 对齐', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { ...base, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    { ...base, waybillNo: 'B', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-26 10:00:00' },
    { ...base, waybillNo: 'C', courierCode: 'C2', courier: 'D2', consigneeRouteCode: 'R2', deliveryTime: '2024-06-25 13:00:00', lastProblemDate: '2024-06-25 18:00:00' },
    { ...base, waybillNo: 'D', consigneeRouteCode: 'R2' },
  ]
  const scopes = [scope('U1', 'V1')]

  const cells = run(rows, scopes)
  const alarm = aggregateDispatch24hByScopes({ rows, stationCodes: ['S1'], rule, scopes })
  const stat = alarm.get('U1')
  assert.ok(stat)

  const sum = (pick: (c: DispatchPerformanceCell) => number) =>
    cells.reduce((acc, c) => acc + pick(c), 0)

  assert.equal(sum((c) => c.total), stat.total)
  assert.equal(sum((c) => c.exitMetSignMet + c.exitUnmetSignMet), stat.met)
  assert.equal(sum((c) => c.problemCount), stat.problemCount)
  assert.equal(sum((c) => c.neverSignedCount), stat.neverSignedCount)
  assert.equal(sum((c) => c.lateSignedCount), stat.lateSignedCount)
})

test('固定截止批次（周五到件）：出仓阈值在下周一11:00，派签截止仍是下周一23:59:59', () => {
  const arrival = '2024-06-28' // 周五到件 → 出仓截止下周一 07-01 11:00，派签截止下周一 07-01 23:59:59
  const weekendRule = resolveDispatch24hWindowRule(arrival, tz)
  const weekendThreshold = dispatchExitThresholdMs(arrival, tz)
  const rows: Dispatch24hWaybillRow[] = [
    // 下周一 10:00 出仓（≤ 周一 11:00）+ 下周一签收（≤ 下周一 23:59:59）→ 双达标
    { ...base, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-07-01 10:00:00', signDate: '2024-07-01 20:00:00' },
    // 下周一 12:00 出仓（超阈值）+ 周二才签收（超下周一 23:59:59）→ 双未达标
    { ...base, waybillNo: 'B', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-07-01 12:00:00', signDate: '2024-07-02 09:00:00' },
  ]
  const [cell] = aggregateDispatchPerformanceCells({
    rows,
    stationCodes: ['S1'],
    rule: weekendRule,
    before11ThresholdMs: weekendThreshold,
    sameDayExitThresholdMs: localDateTimeToMs(`${arrival} 23:59:59`, tz),
    nextDayDeadlineMs: localDateTimeToMs(`${resolveExitDate(arrival)} 23:59:59`, tz),
    scopes: [scope('U1', 'V1')],
  })
  assert.equal(cell.exitMetSignMet, 1)
  assert.equal(cell.exitUnmetSignUnmet, 1)
  // 周五到件的次日派签截止 = 下周一 23:59:59，与该批 24h 固定截止重合
  assert.equal(cell.nextDaySignMet, 1)
  assert.equal(cell.sameDayExitMet, 0, '周五当天没出仓')
})

test('当天出仓 / 次日派签 / 优先件：周一到件，截止分别为 D 23:59:59 与 D+1 23:59:59', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // 到件当天 20:00 就出仓 → 当天出仓达标；次日 10:00 签收 → 次日派签达标
    { ...base, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-24 20:00:00', signDate: '2024-06-25 10:00:00' },
    // 次日 09:00 出仓、D+2 08:00 签收 → 24h 达标，但超过次日 23:59:59，次日派签未达标
    { ...base, waybillNo: 'B', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-26 08:00:00' },
    // 优先件（clientCode 小写也要命中）：次日 22:00 签收 → 次日达标
    { ...base, waybillNo: 'C', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', clientCode: 'p1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 22:00:00' },
    // 优先件：从未派件 → 次日未完成
    { ...base, waybillNo: 'D', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', clientCode: 'P1' },
  ]
  const scopes = [scope('U1', 'V1')]

  const [cell] = run(rows, scopes)
  assert.equal(cell.total, 4)
  assert.equal(cell.sameDayExitMet, 1)
  assert.equal(cell.exitMetSignMet + cell.exitUnmetSignMet, 3, '24h 口径 A/B/C 达标')
  assert.equal(cell.nextDaySignMet, 2, '次日口径只有 A/C 达标')
  assert.equal(cell.priorityTotal, 2)
  assert.equal(cell.priorityNextDaySignMet, 1)

  // 出仓趟：当天出仓与优先件数已定，次日派签还不知道，保持 0
  const [exitCell] = runExitOnly(rows, scopes)
  assert.equal(exitCell.sameDayExitMet, 1)
  assert.equal(exitCell.priorityTotal, 2)
  assert.equal(exitCell.nextDaySignMet, 0)
  assert.equal(exitCell.priorityNextDaySignMet, 0)
})

test('出仓准点 × 次日派签 交叉格：另外三格能由边际减出来且非负', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // 准点出仓 + 次日签收 → 交叉格
    { ...base, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 10:00:00' },
    // 准点出仓 + 超次日才签 → 出仓准点却没派掉
    { ...base, waybillNo: 'B', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-26 08:00:00' },
    // 出仓晚 + 次日签上了 → 赶回来了
    { ...base, waybillNo: 'C', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 13:00:00', signDate: '2024-06-25 20:00:00' },
    // 出仓晚 + 从未签收 → 连锁失败；同时是优先件
    { ...base, waybillNo: 'D', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', clientCode: 'P1' },
    // 优先件：准点出仓 + 次日签收
    { ...base, waybillNo: 'E', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', clientCode: 'P1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 18:00:00' },
  ]
  const [cell] = run(rows, [scope('U1', 'V1')])

  assert.equal(cell.total, 5)
  assert.equal(cell.before11Met, 3, 'A/B/E')
  assert.equal(cell.nextDaySignMet, 3, 'A/C/E')
  assert.equal(cell.exitMetNextDaySignMet, 2, 'A/E')
  // 减法必须减得出非负的四格，且四格之和 = total
  const exitMetUnsigned = cell.before11Met - cell.exitMetNextDaySignMet
  const exitUnmetSigned = cell.nextDaySignMet - cell.exitMetNextDaySignMet
  const bothUnmet =
    cell.total - cell.before11Met - cell.nextDaySignMet + cell.exitMetNextDaySignMet
  assert.deepEqual([exitMetUnsigned, exitUnmetSigned, bothUnmet], [1, 1, 1], 'B / C / D')
  assert.equal(cell.exitMetNextDaySignMet + exitMetUnsigned + exitUnmetSigned + bothUnmet, cell.total)

  // 优先件同一套减法：D 出仓晚且没派掉，E 准点且达成
  assert.equal(cell.priorityTotal, 2)
  assert.equal(cell.priorityBefore11Met, 1, 'E')
  assert.equal(cell.priorityNextDaySignMet, 1, 'E')
  assert.equal(cell.priorityExitMetNextDaySignMet, 1, 'E')
  assert.equal(
    cell.priorityTotal -
      cell.priorityBefore11Met -
      cell.priorityNextDaySignMet +
      cell.priorityExitMetNextDaySignMet,
    1,
    'D 出仓晚且没派掉',
  )

  // 出仓趟：优先件的出仓分母已定，派签相关交叉格还不知道
  const [exitCell] = runExitOnly(rows, [scope('U1', 'V1')])
  assert.equal(exitCell.priorityBefore11Met, 1)
  assert.equal(exitCell.exitMetNextDaySignMet, 0)
  assert.equal(exitCell.priorityExitMetNextDaySignMet, 0)
})

test('白名单路由：照常出格子并打标记，不再被整行剔除', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // R1 正常考核
    { ...base, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    // R2 在白名单里：数据要看得见，但不该计进供应商的率（剔除在查询侧做）
    { ...base, waybillNo: 'B', courierCode: 'C2', courier: 'D2', consigneeRouteCode: 'R2', deliveryTime: '2024-06-25 13:00:00' },
  ]
  const cells = run(rows, [scope('U1', 'V1', ['R1', 'R2'], ['R2'])])

  const byRoute = new Map(cells.map((c) => [c.routeCode, c]))
  assert.equal(byRoute.size, 2, '白名单路由不再被丢弃')
  assert.equal(byRoute.get('R1')?.isWhitelist, false)
  assert.equal(byRoute.get('R2')?.isWhitelist, true)
  // 标记之外，白名单格子的指标与普通格子按同一口径算
  assert.equal(byRoute.get('R2')?.total, 1)
  assert.equal(byRoute.get('R2')?.before11Met, 0)
  assert.equal(byRoute.get('R2')?.neverSignedCount, 1)
})

// ── 利润 ───────────────────────────────────────────────────────────

/** ADELAIDE 2.70/2.45（差 0.25），PROSPECT 3.10/2.80（差 0.30） */
const priceBook = new Map<string, PackagePrice>([
  [priceBookKey('5000', 'ADELAIDE'), { price: 2.7, courierPrice: 2.45 }],
  [priceBookKey('5082', 'PROSPECT'), { price: 3.1, courierPrice: 2.8 }],
])

const adelaide = { postcode: '5000', suburb: 'ADELAIDE' }

test('利润：只算签收成功的包裹，供应商利润 = Σ(price - courierPrice)，司机利润 = Σ courierPrice', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // 签收且命中价格：ADELAIDE ×2 + PROSPECT ×1
    { ...base, ...adelaide, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    // 超 24h 才签收 —— 派签不达标，但钱照算：计费看的是有没有派到，不是达不达标
    { ...base, ...adelaide, waybillNo: 'B', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-27 10:00:00' },
    { ...base, postcode: '5082', suburb: 'PROSPECT', waybillNo: 'C', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 16:00:00' },
    // 从未签收：一分不算
    { ...base, ...adelaide, waybillNo: 'D', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00' },
  ]
  const [cell] = run(rows, [scope('U1', 'V1')], priceBook)

  assert.equal(cell.total, 4)
  assert.equal(cell.pricedSignedCount, 3)
  assert.equal(cell.unpricedSignedCount, 0)
  // 0.25 + 0.25 + 0.30
  assert.equal(Math.round(cell.vendorProfit * 100) / 100, 0.8)
  // 2.45 + 2.45 + 2.80
  assert.equal(Math.round(cell.courierProfit * 100) / 100, 7.7)
})

test('利润：签收但查不到价格的单计入 unpricedSignedCount，不静默按 0 元混进金额', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { ...base, ...adelaide, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    // 价格表里没有这个 suburb
    { ...base, postcode: '5999', suburb: 'NOWHERE', waybillNo: 'B', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
    // iMile 压根没返回地址
    { ...base, waybillNo: 'C', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
  ]
  const [cell] = run(rows, [scope('U1', 'V1')], priceBook)

  assert.equal(cell.pricedSignedCount, 1)
  assert.equal(cell.unpricedSignedCount, 2)
  assert.equal(cell.vendorProfit, 0.25)
  assert.equal(cell.courierProfit, 2.45)
})

test('利润：suburb 大小写不影响匹配（价格表里全大写，iMile 返回的可能是混合大小写）', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { ...base, postcode: '5000', suburb: ' Adelaide ', waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
  ]
  const [cell] = run(rows, [scope('U1', 'V1')], priceBook)

  assert.equal(cell.pricedSignedCount, 1)
  assert.equal(cell.courierProfit, 2.45)
})

test('利润：出仓趟（rule=null）不算钱 —— 那时大半包裹还没签收，算出来必然偏小且会变', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { ...base, ...adelaide, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
  ]
  const [cell] = runExitOnly(rows, [scope('U1', 'V1')], priceBook)

  assert.equal(cell.dispatchSettled, false)
  assert.equal(cell.vendorProfit, 0)
  assert.equal(cell.courierProfit, 0)
  assert.equal(cell.pricedSignedCount, 0)
  assert.equal(cell.unpricedSignedCount, 0)
})

test('利润：没有价格表（该州没配）时全部记入 unpricedSignedCount', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { ...base, ...adelaide, waybillNo: 'A', courierCode: 'C1', courier: 'D1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-25 09:00:00', signDate: '2024-06-25 15:00:00' },
  ]
  const [cell] = run(rows, [scope('U1', 'V1')])

  assert.equal(cell.unpricedSignedCount, 1)
  assert.equal(cell.vendorProfit, 0)
})
