import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUS_TZ } from '../imile/ausTimezone'
import {
  aggregateDispatch24hByVendor,
  getDispatch24hDeadlineMs,
  isDispatch24hMet,
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

test('isDispatch24hTerminal：窗口内未达标仍需刷新；超窗口未达标视为终态', () => {
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
  assert.equal(isDispatch24hTerminal(row, tz, afterWindow), true)
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
  const expired: Dispatch24hWaybillRow = {
    waybillNo: 'C',
    deliveryTime: '2024-06-24 10:00:00',
  }
  const deadline = getDispatch24hDeadlineMs(open, tz)!
  const withinWindow = deadline - 60_000
  const afterWindow = deadline + 60_000
  const cached = new Map<string, Dispatch24hWaybillRow>([
    ['A', met],
    ['B', open],
    ['C', expired],
  ])

  assert.deepEqual(selectWaybillNosNeedingRefresh(['A', 'B', 'C', 'D'], cached, tz, withinWindow), [
    'B',
    'C',
    'D',
  ])
  assert.deepEqual(selectWaybillNosNeedingRefresh(['A', 'B', 'C', 'D'], cached, tz, afterWindow), ['D'])
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
