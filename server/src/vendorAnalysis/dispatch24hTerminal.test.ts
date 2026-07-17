import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUS_TZ, iMileStrToMs } from '../imile/ausTimezone'
import {
  aggregateDispatch24hByVendor,
  getDispatch24hDeadlineMs,
  isDispatch24hMet,
  isDispatch24hProblem,
  isDispatch24hTerminal,
  isDispatch24hWindowExpired,
  selectWaybillNosNeedingRefresh,
  type Dispatch24hWaybillRow,
} from './dispatch24hAggregate'

const tz = AUS_TZ.Adelaide

test('isDispatch24hTerminal：已达标视为终态，无需再拉', () => {
  const row: Dispatch24hWaybillRow = {
    waybillNo: 'W1',
    deliveryTime: '2024-06-24 10:00:00',
    signDate: '2024-06-24 12:00:00',
  }
  assert.equal(isDispatch24hMet(row, tz), true)
  assert.equal(isDispatch24hTerminal(row, tz), true)
})

test('isDispatch24hTerminal：窗口内未达标仍需刷新；超窗口但快照仍是窗口前的旧数据，需补拉一次才视为终态', () => {
  const row: Dispatch24hWaybillRow = {
    waybillNo: 'W2',
    deliveryTime: '2024-06-24 10:00:00',
  }
  const deadline = getDispatch24hDeadlineMs(row, tz)
  assert.ok(deadline != null)
  const withinWindow = deadline - 60_000
  const afterWindow = deadline + 60_000

  assert.equal(isDispatch24hWindowExpired(row, tz, withinWindow), false)
  assert.equal(isDispatch24hTerminal(row, tz, withinWindow), false)
  assert.equal(isDispatch24hMet(row, tz), false)
  assert.equal(isDispatch24hWindowExpired(row, tz, afterWindow), true)

  // 没有 syncedAtMs（从未同步过）：窗口过了也不能锁定终态，还得再拉一次确认
  assert.equal(isDispatch24hTerminal(row, tz, afterWindow), false)

  // 最后一次同步是在 deadline 之前的旧快照：仍需补拉，不能直接冻结
  const staleSynced: Dispatch24hWaybillRow = { ...row, syncedAtMs: deadline - 30_000 }
  assert.equal(isDispatch24hTerminal(staleSynced, tz, afterWindow), false)

  // 最后一次同步已经在 deadline 之后：拿到的就是最终结果，可以锁定终态
  const freshSynced: Dispatch24hWaybillRow = { ...row, syncedAtMs: deadline + 10_000 }
  assert.equal(isDispatch24hTerminal(freshSynced, tz, afterWindow), true)
})

test('selectWaybillNosNeedingRefresh：只返回未终态单号', () => {
  const met: Dispatch24hWaybillRow = {
    waybillNo: 'A',
    deliveryTime: '2024-06-24 10:00:00',
    signDate: '2024-06-24 12:00:00',
  }
  const open: Dispatch24hWaybillRow = {
    waybillNo: 'B',
    deliveryTime: '2024-06-24 10:00:00',
  }
  const deadline = getDispatch24hDeadlineMs(open, tz)!
  // 窗口过后才补拉过一次，无需再刷新
  const expiredSynced: Dispatch24hWaybillRow = {
    waybillNo: 'C',
    deliveryTime: '2024-06-24 10:00:00',
    syncedAtMs: deadline + 10_000,
  }
  // 窗口已过，但最后一次同步还是窗口前的旧快照，仍需刷新
  const expiredStale: Dispatch24hWaybillRow = {
    waybillNo: 'E',
    deliveryTime: '2024-06-24 10:00:00',
    syncedAtMs: deadline - 30_000,
  }
  const withinWindow = deadline - 60_000
  const afterWindow = deadline + 60_000
  const cached = new Map<string, Dispatch24hWaybillRow>([
    ['A', met],
    ['B', open],
    ['C', expiredSynced],
    ['E', expiredStale],
  ])

  assert.deepEqual(selectWaybillNosNeedingRefresh(['A', 'B', 'C', 'D'], cached, tz, withinWindow), [
    'B',
    'C',
    'D',
  ])
  assert.deepEqual(
    selectWaybillNosNeedingRefresh(['A', 'B', 'C', 'D', 'E'], cached, tz, afterWindow),
    ['B', 'D', 'E'],
  )
})

test('isDispatch24hProblem：问题件时间需晚于派件时间才算本次派送产生的问题件', () => {
  // 第一次派送 10:00 上报问题件 18:00，未被重新派送：问题件有效
  const currentAttempt: Dispatch24hWaybillRow = {
    deliveryTime: '2024-06-24 10:00:00',
    lastProblemDate: '2024-06-24 18:00:00',
  }
  assert.equal(isDispatch24hProblem(currentAttempt), true)

  // 第一次派送 10:00 上报问题件后，包裹被重新派送（第二次 deliveryTime 晚于问题件时间）：旧问题件不算数
  const redispatched: Dispatch24hWaybillRow = {
    deliveryTime: '2024-06-25 09:00:00',
    lastProblemDate: '2024-06-24 18:00:00',
  }
  assert.equal(isDispatch24hProblem(redispatched), false)

  // 问题件时间恰好等于派件时间：按“不算”处理（严格要求晚于）
  const equalTime: Dispatch24hWaybillRow = {
    deliveryTime: '2024-06-24 10:00:00',
    lastProblemDate: '2024-06-24 10:00:00',
  }
  assert.equal(isDispatch24hProblem(equalTime), false)
})

test('isDispatch24hMet：重新派送后旧问题件不能再当作达标依据', () => {
  const deadline = getDispatch24hDeadlineMs({ deliveryTime: '2024-06-25 09:00:00' }, tz)!
  // 未签收、问题件是重新派送前的旧记录（早于本次 deliveryTime），即使在 deadline 前也不能判定达标
  const row: Dispatch24hWaybillRow = {
    deliveryTime: '2024-06-25 09:00:00',
    lastProblemDate: '2024-06-24 18:00:00',
  }
  assert.ok(deadline > iMileStrToMs('2024-06-24 18:00:00'))
  assert.equal(isDispatch24hMet(row, tz), false)
})

test('aggregateDispatch24hByVendor：同 vendorCode 按不同 routeCode 纳入时可拆成独立统计', () => {
  const rows: Dispatch24hWaybillRow[] = [
    {
      waybillNo: 'A1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
    {
      waybillNo: 'B1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-B',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
  ]

  const regionA = aggregateDispatch24hByVendor({
    rows,
    stationCodes: ['S1'],
    tz,
    routeCodesByVendor: new Map([['V1', new Set(['R-A'])]]),
    routeCodeWhitelistByVendor: new Map(),
  }).get('V1')
  const regionB = aggregateDispatch24hByVendor({
    rows,
    stationCodes: ['S1'],
    tz,
    routeCodesByVendor: new Map([['V1', new Set(['R-B'])]]),
    routeCodeWhitelistByVendor: new Map(),
  }).get('V1')

  assert.equal(regionA?.total, 1)
  assert.deepEqual(regionA?.unmetNos, [])
  assert.equal(regionB?.total, 1)
  assert.deepEqual(regionB?.unmetNos, [])
})

test('aggregateDispatch24hByVendor：problemCount 按供应商与司机两级统计，重新派送的旧问题件不计入', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // 本次派送产生的有效问题件：计入
    {
      waybillNo: 'P1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
      deliveryTime: '2024-06-24 10:00:00',
      lastProblemDate: '2024-06-24 18:00:00',
    },
    // 第一次派送的问题件，随后被重新派送：不计入
    {
      waybillNo: 'P2',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
      deliveryTime: '2024-06-25 09:00:00',
      lastProblemDate: '2024-06-24 18:00:00',
    },
    // 正常签收，无问题件
    {
      waybillNo: 'P3',
      courierCode: 'C2',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-B',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
  ]

  const stat = aggregateDispatch24hByVendor({
    rows,
    stationCodes: ['S1'],
    tz,
    routeCodeWhitelistByVendor: new Map(),
  }).get('V1')

  assert.equal(stat?.total, 3)
  assert.equal(stat?.problemCount, 1)

  const c1 = stat?.drivers.find((d) => d.courierCode === 'C1')
  const c2 = stat?.drivers.find((d) => d.courierCode === 'C2')
  assert.equal(c1?.problemCount, 1)
  assert.equal(c2?.problemCount, 0)
  assert.deepEqual(
    c1?.problemWaybills.map((w) => w.waybillNo),
    ['P1'],
  )
  assert.deepEqual(c2?.problemWaybills, [])
})
