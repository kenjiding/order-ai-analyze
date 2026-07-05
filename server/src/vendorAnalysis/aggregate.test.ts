import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateVendorAnalysis, type VendorAnalyzeAggregateInput } from './aggregate'
import { AUS_TZ } from '../imile/ausTimezone'

// 2024-06-24 是周一，2024-06-28 是周五（用于校验 24H 派签的星期规则）
function baseInput(overrides: Partial<VendorAnalyzeAggregateInput> = {}): VendorAnalyzeAggregateInput {
  return {
    tickets: [],
    waybills: [],
    unprocessedTickets: { normalTickets: [], complaintTickets: [], arbitrationTickets: [] },
    longTailOrders: [],
    before11ExitRateByVendor: {},
    driverYesterdayWaybills: [],
    driverDayBeforeWaybills: [],
    driverReturnRows: [],
    stationCodes: ['S1'],
    tz: AUS_TZ.Adelaide,
    nowMs: new Date('2024-07-05T00:00:00Z').getTime(),
    ...overrides,
  }
}

test('24H派签：周一24h内签收达标、超24h不达标、周五按下周一23:59:59截止', () => {
  const rows = [
    // 周一 10:00 派件，当天 12:00 签收 → 24h 内达标
    { waybillNo: 'W1', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' },
    // 周一 10:00 派件，周三 10:00:01 签收 → 超 24h 不达标
    { waybillNo: 'W2', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-26 10:00:01' },
    // 周五 10:00 派件，下周一 20:00 签收（<=下周一 23:59:59）→ 达标
    { waybillNo: 'W3', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', deliveryTime: '2024-06-28 10:00:00', signDate: '2024-07-01 20:00:00' },
    // 站点 S9 不在口径内 → 被过滤，不计入
    { waybillNo: 'W4', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S9', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 11:00:00' },
  ]
  const [v] = aggregateVendorAnalysis(baseInput({ driverDayBeforeWaybills: rows }))

  assert.equal(v.vendorCode, 'V1')
  assert.equal(v.dispatch24hTotal, 3)
  assert.equal(v.dispatch24hCount, 2)
  assert.equal(v.notMet24hSignCount, 1)
  assert.equal(v.dispatchRate24hText, '66.67%')
  assert.deepEqual(v.dispatch24hUnmetWaybillNos, ['W2'])
})

test('供应商级：客诉率按站点过滤、11点前/未处理/长尾/归班汇总正确', () => {
  const input = baseInput({
    tickets: [
      { relatedResponsibleHubCode: 'S1', responsibleDeptCode: 'V1', orderCode: 'O1' },
      { relatedResponsibleHubCode: 'S9', responsibleDeptCode: 'V1', orderCode: 'O2' }, // 站点外，过滤
    ],
    waybills: [{ courierVendorCode: 'V1' }, { courierVendorCode: 'V1' }],
    unprocessedTickets: {
      normalTickets: [{ currentHandleStationCode: 'S1', currentHandleCode: 'V1', orderCode: 'U1' }],
      complaintTickets: [],
      arbitrationTickets: [],
    },
    longTailOrders: [{ driverCode: 'C1', driverVendorCode: 'V1', waybillNo: 'L1', driverName: 'Cai' }],
    before11ExitRateByVendor: { V1: { before11ExitRate: 0.8, before11ExitVolume: 8, totalReceived: 10 } },
    driverYesterdayWaybills: [
      { waybillNo: 'P1', courierCode: 'C1', courierVendorCode: 'V1', courier: 'Cai', consigneeRouteCode: 'R1', before11Exit: true },
      { waybillNo: 'P2', courierCode: 'C1', courierVendorCode: 'V1', courier: 'Cai', consigneeRouteCode: 'R1', before11Exit: false },
    ],
    driverReturnRows: [
      { driverCode: 'C1', driverVendorCode: 'V1', ofdDate: '2024-06-01 00:00:00', waybillNo: 'RW1', driverName: 'Cai' },
    ],
  })
  const [v] = aggregateVendorAnalysis(input)

  assert.equal(v.complaintCount, 1)
  assert.equal(v.waybillCount, 2)
  assert.equal(v.complaintRate, 0.5)
  assert.deepEqual(v.complaintOrderCodes, ['O1'])
  assert.equal(v.unprocessedTicketCount, 1)
  assert.equal(v.longTailCount, 1)
  assert.equal(v.before11ExitRate, 0.8)
  assert.deepEqual(v.before11UnmetWaybillNos, ['P2'])

  const driver = v.drivers.find((d) => d.courierCode === 'C1')
  assert.ok(driver)
  assert.equal(driver.ofdCount, 2)
  assert.equal(driver.before11OfdCount, 1)
  assert.deepEqual(driver.before11UnmetWaybillNos, ['P2'])
  assert.equal(driver.longTailCount, 1)
  assert.equal(driver.returnWarningCount, 1)
})
