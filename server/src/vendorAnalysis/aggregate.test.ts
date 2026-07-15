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
    routeCodesByVendor: new Map(),
    routeCodeWhitelistByVendor: new Map(),
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

test('24H派签：周五~日问题件在下周一23:59:59前达标，超截止或不登记问题件不达标', () => {
  const rows = [
    // 周五 10:00 派件，无签收，下周一 18:00 登记问题件 → 达标
    { waybillNo: 'W5', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', deliveryTime: '2024-06-28 10:00:00', lastProblemDate: '2024-07-01 18:00:00' },
    // 周六 10:00 派件，无签收，下周二登记问题件 → 超截止不达标
    { waybillNo: 'W6', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', deliveryTime: '2024-06-29 10:00:00', lastProblemDate: '2024-07-02 10:00:00' },
    // 周日 10:00 派件，无签收无问题件 → 不达标
    { waybillNo: 'W7', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', deliveryTime: '2024-06-30 10:00:00' },
  ]
  const [v] = aggregateVendorAnalysis(baseInput({ driverDayBeforeWaybills: rows }))

  assert.equal(v.dispatch24hTotal, 3)
  assert.equal(v.dispatch24hCount, 1)
  assert.deepEqual(v.dispatch24hUnmetWaybillNos, ['W6', 'W7'])
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

test('路由码白名单：命中白名单的运单从运单量/24H派签/11点前统计中整体剔除', () => {
  const input = baseInput({
    waybills: [
      { courierVendorCode: 'V1', consigneeRouteCode: 'R1' }, // 命中白名单，剔除
      { courierVendorCode: 'V1', consigneeRouteCode: 'R2' },
    ],
    driverYesterdayWaybills: [
      { waybillNo: 'P1', courierCode: 'C1', courierVendorCode: 'V1', courier: 'Cai', consigneeRouteCode: 'R1', before11Exit: false }, // 命中白名单，剔除
      { waybillNo: 'P2', courierCode: 'C1', courierVendorCode: 'V1', courier: 'Cai', consigneeRouteCode: 'R2', before11Exit: false },
    ],
    driverDayBeforeWaybills: [
      { waybillNo: 'D1', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' }, // 命中白名单，剔除
      { waybillNo: 'D2', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R2', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' },
    ],
    routeCodeWhitelistByVendor: new Map([['V1', new Set(['R1'])]]),
  })
  const [v] = aggregateVendorAnalysis(input)

  assert.equal(v.waybillCount, 1)
  assert.equal(v.dispatch24hTotal, 1)
  assert.deepEqual(v.before11UnmetWaybillNos, ['P2'])

  const driver = v.drivers.find((d) => d.courierCode === 'C1')
  assert.ok(driver)
  assert.equal(driver.ofdCount, 1)
  assert.deepEqual(driver.ofdWaybillNos, ['P2'])
  assert.equal(driver.totalDispatchCount, 1)
})

test('24H派签：routeCode 纳入筛选后只统计配置路由；白名单再剔除', () => {
  const rows = [
    { waybillNo: 'A1', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-A', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' },
    { waybillNo: 'B1', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-B', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' },
    { waybillNo: 'C1', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-C', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' }, // 不在纳入名单
    { waybillNo: 'A2', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-A', deliveryTime: '2024-06-24 10:00:00' }, // 纳入但未达标；若在白名单则剔除
  ]
  const [v] = aggregateVendorAnalysis(
    baseInput({
      driverDayBeforeWaybills: rows,
      routeCodesByVendor: new Map([['V1', new Set(['R-A', 'R-B'])]]),
      routeCodeWhitelistByVendor: new Map([['V1', new Set(['R-A'])]]),
    }),
  )

  // 仅 R-B 的 B1 计入（R-A 被白名单剔除，R-C 未纳入）
  assert.equal(v.dispatch24hTotal, 1)
  assert.equal(v.dispatch24hCount, 1)
  assert.deepEqual(v.dispatch24hUnmetWaybillNos, [])

  const driver = v.drivers.find((d) => d.courierCode === 'C1')
  assert.ok(driver)
  assert.equal(driver.totalDispatchCount, 1)
  assert.equal(driver.dispatch24hCount, 1)
})
