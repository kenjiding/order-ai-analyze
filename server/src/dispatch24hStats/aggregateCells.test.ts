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
import { aggregateDispatchPerformanceCells, type DispatchPerformanceCell } from './aggregateCells'

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
function run(rows: Dispatch24hWaybillRow[], scopes: Dispatch24hScope[]): DispatchPerformanceCell[] {
  return aggregateDispatchPerformanceCells({
    rows,
    stationCodes: ['S1'],
    rule,
    before11ThresholdMs: threshold,
    sameDayExitThresholdMs: sameDayThreshold,
    nextDayDeadlineMs: nextDayDeadline,
    scopes,
    priorityClientCodes,
  })
}

/** 出仓趟（D+1）：rule=null，只结算出仓 */
function runExitOnly(rows: Dispatch24hWaybillRow[], scopes: Dispatch24hScope[]): DispatchPerformanceCell[] {
  return aggregateDispatchPerformanceCells({
    rows,
    stationCodes: ['S1'],
    rule: null,
    before11ThresholdMs: threshold,
    sameDayExitThresholdMs: sameDayThreshold,
    nextDayDeadlineMs: nextDayDeadline,
    scopes,
    priorityClientCodes,
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
