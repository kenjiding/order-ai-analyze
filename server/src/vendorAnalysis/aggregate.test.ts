import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateVendorAnalysis, type VendorAnalyzeAggregateInput } from './aggregate'
import { buildSupplierUnitIndex } from './supplierScope'
import { AUS_TZ } from '../imile/ausTimezone'

/** 用供应商配置建供应商单位索引（统计主键的来源） */
function unitsFrom(
  configs: Array<{
    vendorCode: string
    supplierNickname?: string
    routeCode?: string
    routeCodeWhitelist?: string
  }>,
) {
  return buildSupplierUnitIndex(
    configs.map((c) => ({
      vendorCode: c.vendorCode,
      vendorName: c.vendorCode,
      supplierNickname: c.supplierNickname ?? '',
      routeCode: c.routeCode ?? '',
      routeCodeWhitelist: c.routeCodeWhitelist ?? '',
    })) as never,
  )
}

// 2024-06-24 是周一，2024-06-28 是周五（用于校验 24H 派签的星期规则）
function baseInput(overrides: Partial<VendorAnalyzeAggregateInput> = {}): VendorAnalyzeAggregateInput {
  return {
    tickets: [],
    waybills: [],
    unprocessedTickets: { normalTickets: [], complaintTickets: [], arbitrationTickets: [] },
    longTailOrders: [],
    driverYesterdayWaybills: [],
    driverDayBeforeWaybills: [],
    driverReturnRows: [],
    stationCodes: ['S1'],
    tz: AUS_TZ.Adelaide,
    nowMs: new Date('2024-07-05T00:00:00Z').getTime(),
    supplierUnits: unitsFrom([{ vendorCode: 'V1' }]),
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
    // 出仓率由业务层从 driverYesterdayWaybills 投影：P1 出仓、P2 未出仓 → 1/2 = 0.5
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
  assert.equal(v.before11ExitRate, 0.5) // 业务层投影：P1 出仓 / (P1+P2) = 1/2
  assert.equal(v.before11ExitVolume, 1)
  assert.equal(v.before11TotalReceived, 2)
  assert.deepEqual(v.before11UnmetWaybillNos, ['P2'])

  const driver = v.drivers.find((d) => d.courierCode === 'C1')
  assert.ok(driver)
  assert.equal(driver.ofdCount, 2)
  assert.equal(driver.before11OfdCount, 1)
  assert.deepEqual(driver.before11UnmetWaybillNos, ['P2'])
  assert.equal(driver.longTailCount, 1)
  assert.equal(driver.returnWarningCount, 1)
})

test('路由码白名单：11点前出仓/24H派签口径剔除（含未出仓单号、司机出率分母）；客诉率分母与今日取件量按全量', () => {
  const input = baseInput({
    waybills: [
      { courierVendorCode: 'V1', consigneeRouteCode: 'R1' }, // 命中白名单，但揽收量不剔除
      { courierVendorCode: 'V1', consigneeRouteCode: 'R2' },
    ],
    driverYesterdayWaybills: [
      { waybillNo: 'P1', courierCode: 'C1', courierVendorCode: 'V1', courier: 'Cai', consigneeRouteCode: 'R1', before11Exit: false }, // 命中白名单，但取件量/未出仓不剔除
      { waybillNo: 'P2', courierCode: 'C1', courierVendorCode: 'V1', courier: 'Cai', consigneeRouteCode: 'R2', before11Exit: false },
    ],
    driverDayBeforeWaybills: [
      { waybillNo: 'D1', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R1', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' }, // 命中白名单，剔除
      { waybillNo: 'D2', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R2', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' },
    ],
    supplierUnits: unitsFrom([{ vendorCode: 'V1', routeCodeWhitelist: 'R1' }]),
  })
  const [v] = aggregateVendorAnalysis(input)

  assert.equal(v.waybillCount, 2) // 客诉率分母：不剔除白名单，R1、R2 都计入
  assert.equal(v.dispatch24hTotal, 1) // 24H派签：剔除白名单，只剩 D2
  assert.equal(v.before11ExitRate, 0) // 出仓率剔除白名单后只剩 P2(未出仓) → 0/1
  assert.equal(v.before11TotalReceived, 1)
  assert.deepEqual(v.before11UnmetWaybillNos, ['P2']) // 未出仓单号属于11点前出仓口径：剔除白名单 R1

  const driver = v.drivers.find((d) => d.courierCode === 'C1')
  assert.ok(driver)
  assert.equal(driver.ofdCount, 2) // 今日取件量：不剔除白名单，P1、P2 都计入
  assert.deepEqual(driver.ofdWaybillNos, ['P1', 'P2'])
  assert.equal(driver.before11TotalCount, 1) // 11点前出率分母：剔除白名单，只剩 P2
  assert.equal(driver.before11OfdCount, 0) // P2 未在11点前出仓
  assert.deepEqual(driver.before11UnmetWaybillNos, ['P2']) // 出率钻取：剔除白名单 R1
  assert.equal(driver.totalDispatchCount, 1) // 24H派签：剔除白名单
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
      supplierUnits: unitsFrom([{ vendorCode: 'V1', routeCode: 'R-A R-B', routeCodeWhitelist: 'R-A' }]),
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

test('同 vendorCode 不同路由码的两家（ADL-City / ADL-Lu）各自独立成行，数据不混算', () => {
  const input = baseInput({
    waybills: [
      { courierVendorCode: 'SRM01', consigneeRouteCode: 'ADL-C1' },
      { courierVendorCode: 'SRM01', consigneeRouteCode: 'ADL-C1' },
      { courierVendorCode: 'SRM01', consigneeRouteCode: 'ADL-L1' },
    ],
    driverDayBeforeWaybills: [
      // City：2 单，1 单达标
      { waybillNo: 'C-1', courierCode: 'DC', courierVendorCode: 'SRM01', lastScanSiteCode: 'S1', consigneeRouteCode: 'ADL-C1', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' },
      { waybillNo: 'C-2', courierCode: 'DC', courierVendorCode: 'SRM01', lastScanSiteCode: 'S1', consigneeRouteCode: 'ADL-C1', deliveryTime: '2024-06-24 10:00:00' },
      // Lu：1 单，达标
      { waybillNo: 'L-1', courierCode: 'DL', courierVendorCode: 'SRM01', lastScanSiteCode: 'S1', consigneeRouteCode: 'ADL-L1', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' },
    ],
    supplierUnits: unitsFrom([
      { vendorCode: 'SRM01', supplierNickname: 'ADL-City', routeCode: 'ADL-C1' },
      { vendorCode: 'SRM01', supplierNickname: 'ADL-Lu', routeCode: 'ADL-L1' },
    ]),
  })
  const result = aggregateVendorAnalysis(input)

  const city = result.find((v) => v.supplierName === 'ADL-City')
  const lu = result.find((v) => v.supplierName === 'ADL-Lu')
  assert.ok(city && lu)
  // 两家共用同一个 vendorCode，但各占一行、各算各的
  assert.equal(city.vendorCode, 'SRM01')
  assert.equal(lu.vendorCode, 'SRM01')
  assert.notEqual(city.supplierKey, lu.supplierKey)

  assert.equal(city.waybillCount, 2)
  assert.equal(lu.waybillCount, 1)
  assert.equal(city.dispatch24hTotal, 2)
  assert.equal(city.dispatch24hCount, 1)
  assert.deepEqual(city.dispatch24hUnmetWaybillNos, ['C-2'])
  assert.equal(lu.dispatch24hTotal, 1)
  assert.equal(lu.dispatch24hCount, 1)
  assert.deepEqual(lu.dispatch24hUnmetWaybillNos, [])

  // 司机也各归各家，不会互相出现在对方的司机列表里
  assert.deepEqual(city.drivers.map((d) => d.courierCode), ['DC'])
  assert.deepEqual(lu.drivers.map((d) => d.courierCode), ['DL'])
})

test('同 vendorCode 多家时：客诉/工单无路由码拆不开，各家取全量值并标记 sharedVendorCode', () => {
  const input = baseInput({
    tickets: [
      { relatedResponsibleHubCode: 'S1', responsibleDeptCode: 'SRM01', orderCode: 'O1' },
      { relatedResponsibleHubCode: 'S1', responsibleDeptCode: 'SRM01', orderCode: 'O2' },
    ],
    waybills: [
      { courierVendorCode: 'SRM01', consigneeRouteCode: 'ADL-C1' },
      { courierVendorCode: 'SRM01', consigneeRouteCode: 'ADL-L1' },
    ],
    unprocessedTickets: {
      normalTickets: [{ currentHandleStationCode: 'S1', currentHandleCode: 'SRM01', orderCode: 'U1' }],
      complaintTickets: [],
      arbitrationTickets: [],
    },
    supplierUnits: unitsFrom([
      { vendorCode: 'SRM01', supplierNickname: 'ADL-City', routeCode: 'ADL-C1' },
      { vendorCode: 'SRM01', supplierNickname: 'ADL-Lu', routeCode: 'ADL-L1' },
    ]),
  })
  const result = aggregateVendorAnalysis(input)
  const city = result.find((v) => v.supplierName === 'ADL-City')
  const lu = result.find((v) => v.supplierName === 'ADL-Lu')
  assert.ok(city && lu)

  // 客诉/工单只有供应商编码，两家都取该编码的全量值，并标记未拆分
  assert.equal(city.sharedVendorCode, true)
  assert.equal(lu.sharedVendorCode, true)
  assert.equal(city.complaintCount, 2)
  assert.equal(lu.complaintCount, 2)
  assert.equal(city.unprocessedTicketCount, 1)
  assert.equal(lu.unprocessedTicketCount, 1)
  // 客诉率分子拆不开，分母也用编码全量（2/2），不用各家拆分后的揽收量
  assert.equal(city.complaintRate, 1)
  assert.equal(lu.complaintRate, 1)
  // 揽收量本身有路由码，按家拆分
  assert.equal(city.waybillCount, 1)
  assert.equal(lu.waybillCount, 1)
})

test('长尾单/归班预警无路由码，按司机归属落到正确的那一家', () => {
  const input = baseInput({
    driverYesterdayWaybills: [
      { waybillNo: 'P1', courierCode: 'DC', courierVendorCode: 'SRM01', courier: 'City司机', consigneeRouteCode: 'ADL-C1', before11Exit: true },
      { waybillNo: 'P2', courierCode: 'DL', courierVendorCode: 'SRM01', courier: 'Lu司机', consigneeRouteCode: 'ADL-L1', before11Exit: true },
    ],
    longTailOrders: [
      { driverCode: 'DC', driverVendorCode: 'SRM01', waybillNo: 'L1', driverName: 'City司机' },
      { driverCode: 'DL', driverVendorCode: 'SRM01', waybillNo: 'L2', driverName: 'Lu司机' },
      { driverCode: 'DL', driverVendorCode: 'SRM01', waybillNo: 'L3', driverName: 'Lu司机' },
    ],
    driverReturnRows: [
      { driverCode: 'DC', driverVendorCode: 'SRM01', ofdDate: '2024-06-01 00:00:00', waybillNo: 'RW1', driverName: 'City司机' },
    ],
    supplierUnits: unitsFrom([
      { vendorCode: 'SRM01', supplierNickname: 'ADL-City', routeCode: 'ADL-C1' },
      { vendorCode: 'SRM01', supplierNickname: 'ADL-Lu', routeCode: 'ADL-L1' },
    ]),
  })
  const result = aggregateVendorAnalysis(input)
  const city = result.find((v) => v.supplierName === 'ADL-City')
  const lu = result.find((v) => v.supplierName === 'ADL-Lu')
  assert.ok(city && lu)

  // 长尾：DC 的 1 单归 City，DL 的 2 单归 Lu，不再两家各显示 3 单
  assert.equal(city.longTailCount, 1)
  assert.equal(lu.longTailCount, 2)
  // 归班预警只有 DC 有，只出现在 City 的司机行里
  assert.equal(city.drivers.find((d) => d.courierCode === 'DC')?.returnWarningCount, 1)
  assert.equal(lu.drivers.find((d) => d.courierCode === 'DC'), undefined)
})
