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
