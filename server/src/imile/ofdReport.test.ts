import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExitAlarmWaybillRecords, indexOfdRows } from './ofdReport'
import { tagBefore11Rows } from '../vendorAnalysis/before11Aggregate'
import { computeThresholdMsOnDate } from './before11Exit'

const ofd = (waybillNo: string, scanTime: string, vendor: string, cancelled = false) => ({
  waybillNo,
  scanTime,
  driverVendorCode: vendor,
  driverCode: `D-${vendor}`,
  driverName: 'x',
  consigneeRouteCode: 'R-OFD',
  clientCode: 'C-OFD',
  isCancel: cancelled ? 1 : 0,
  isValidOfd: cancelled ? 0 : 1,
})

test('OFD 命中 = 已出仓；重派取有效那次；只剩失效记录仍算出仓；查不到 = 未出仓且路由码/商家取到件记录', () => {
  const inbound = [
    { waybillNo: 'A', routeCode: 'R-IN', clientCode: 'C-IN' },
    { waybillNo: 'A', routeCode: 'R-IN', clientCode: 'C-IN' },
    { waybillNo: 'B', routeCode: 'R-B', clientCode: 'C-B' },
    { waybillNo: 'C', routeCode: 'R-C', clientCode: 'C-C' },
    { waybillNo: 'D', routeCode: 'R-D', clientCode: 'C-D' },
  ]
  const ofdByNo = indexOfdRows([
    ofd('A', '2026-10-09 08:00:00', 'V1'),
    // B：第一次派送失败（被 iMile 标失效）后由另一家重派，归属以有效那次为准
    ofd('B', '2026-10-08 17:00:00', 'V-OLD', true),
    ofd('B', '2026-10-09 09:00:00', 'V-NEW'),
    // C：派送失败、尚未重派，只剩失效记录——当时确实出过仓
    ofd('C', '2026-10-08 17:00:00', 'V3', true),
  ])
  const records = buildExitAlarmWaybillRecords(inbound, ofdByNo)
  assert.equal(records.length, 4)
  const tagged = tagBefore11Rows({
    rows: records,
    before11ThresholdMs: computeThresholdMsOnDate('2026-10-09', 'Australia/Melbourne', '11:00'),
  })
  const pick = (no: string) => {
    const r = tagged.find((t) => t.waybillNo === no)!
    return [r.before11Exit, r.courierVendorCode, r.consigneeRouteCode, r.clientCode]
  }
  assert.deepEqual(pick('A'), [true, 'V1', 'R-OFD', 'C-OFD'])
  assert.deepEqual(pick('B'), [true, 'V-NEW', 'R-OFD', 'C-OFD'])
  assert.deepEqual(pick('C'), [true, 'V3', 'R-OFD', 'C-OFD'])
  assert.deepEqual(pick('D'), [false, '', 'R-D', 'C-D'])
})

test('24H 明细：派件=OFD scanTime、签收=OFD deliveredTime、问题件取最后一次登记；未出仓单路由码/商家/邮编取到件记录', async () => {
  const { buildDispatchWaybillRecords, indexLastProblems } = await import('./ofdReport')
  const { isDispatch24hMet, isDispatch24hProblem } = await import('../vendorAnalysis/dispatch24hAggregate')
  const ofdByNo = indexOfdRows([
    { ...ofd('S', '2026-10-06 17:39:19', 'V1'), deliveredTime: '2026-10-07 12:46:39', consigneeZipCode: '5074', consigneeCity: 'NEWTON' },
    { ...ofd('P', '2026-10-06 17:02:55', 'V1'), deliveredTime: null },
  ])
  // P 报过两次问题件：取最晚那次（第一次在派件前，不算本次派送）
  const problemByNo = indexLastProblems([
    { waybillNo: 'P', registerDate: '2026-10-07 17:30:11', problemReasonDesc: '地址错误' },
    { waybillNo: 'P', registerDate: '2026-10-08 09:05:47', problemReasonDesc: '没有联系上', lastScanStationCode: 'S210431701' },
    // 错发件：已转运到外站，最新扫描网点不是本站
    { waybillNo: 'N', registerDate: '2026-10-06 15:56:24', problemReasonDesc: '错发件', lastScanStationCode: 'S210319' },
  ])
  const records = buildDispatchWaybillRecords({
    waybillNos: ['S', 'P', 'N'],
    ofdByNo,
    problemByNo,
    inboundRows: [{ waybillNo: 'N', routeCode: 'R-N', clientCode: 'C-N', consigneeZipCode: '5000', consigneeCity: 'ADELAIDE', city: 'GILLMAN' }],
  })
  const [s, p, n] = records as any[]
  assert.deepEqual(
    [s.deliveryTime, s.signDate, s.courierVendorCode, s.consigneeZipCode, s.consigneeCity, s.lastProblemDate],
    ['2026-10-06 17:39:19', '2026-10-07 12:46:39', 'V1', '5074', 'NEWTON', null],
  )
  assert.deepEqual([p.signDate, p.lastProblemDate, p.problemReason], [null, '2026-10-08 09:05:47', '没有联系上'])
  assert.deepEqual([s.lastScanSiteCode, p.lastScanSiteCode, n.lastScanSiteCode], ['', 'S210431701', 'S210319'])
  assert.deepEqual(
    [n.deliveryTime, n.courierVendorCode, n.consigneeRouteCode, n.clientCode, n.consigneeZipCode, n.consigneeCity],
    [null, '', 'R-N', 'C-N', '5000', 'ADELAIDE'],
  )
  // 接上原有 24H 判定：S 24h 内签收达标；P 是本次派送的问题件；N 未出仓不达标
  const rule = { kind: 'rolling24h' } as const
  assert.equal(isDispatch24hMet(s, rule), true)
  assert.equal(isDispatch24hProblem(p), true)
  assert.equal(isDispatch24hMet(n, rule), false)
})
