import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDispatchWaybillRecord } from './inboundWaybillIndex'

test('三报表拼字段：OFD 给 deliveryTime/承运商，delivered/query 优先给 signDate，problem/search 给问题件', () => {
  const row = buildDispatchWaybillRecord(
    'W1',
    {
      waybillNo: 'W1',
      consigneeRouteCode: 'R1',
      driverVendorCode: 'V1',
      driverCode: 'D1',
      driverName: '张三',
      clientCode: 'C1',
      scanTime: '2026-10-08 09:00:00',
      deliveredTime: '2026-10-08 20:00:00',
      consigneeZipCode: '5000',
      consigneeCity: 'ADELAIDE',
      valid: true,
    },
    { deliveredDate: '2026-10-08 12:00:00', daCode: 'D1', daName: '张三', clientCode: 'C1', routeCode: 'R1' },
    { registerDate: '', reason: '', lastScanStationCode: '' },
    { routeCode: 'R0', clientCode: 'C0' },
  )
  assert.deepEqual(
    [row.waybillNo, row.deliveryTime, row.signDate, row.courierCode, row.courier, row.courierVendorCode],
    ['W1', '2026-10-08 09:00:00', '2026-10-08 12:00:00', 'D1', '张三', 'V1'],
  )
  assert.deepEqual([row.consigneeRouteCode, row.clientCode, row.consigneeZipCode, row.consigneeCity], ['R1', 'C1', '5000', 'ADELAIDE'])
  assert.equal(row.lastProblemDate, null)
})

test('未出仓单：OFD 查不到时路由码/商家码退回到件记录兜底，deliveryTime/signDate 仍为空', () => {
  const row = buildDispatchWaybillRecord('W2', undefined, undefined, undefined, { routeCode: 'R0', clientCode: 'C0' })
  assert.equal(row.deliveryTime, null)
  assert.equal(row.signDate, null)
  assert.equal(row.consigneeRouteCode, 'R0')
  assert.equal(row.clientCode, 'C0')
})

test('三份明细都查不到时仍产出空壳行，不从结果里消失（否则会被 selectWaybillNosNeedingRefresh/聚合悄悄漏计）', () => {
  const row = buildDispatchWaybillRecord('W3', undefined, undefined, undefined, undefined)
  assert.equal(row.waybillNo, 'W3')
  assert.equal(row.deliveryTime, null)
  assert.equal(row.signDate, null)
  assert.equal(row.consigneeRouteCode, '')
  assert.equal(row.clientCode, '')
})

test('问题件：registerDate/reason/lastScanStationCode 原样透传到 lastProblemDate/problemReason/lastScanSiteCode', () => {
  const row = buildDispatchWaybillRecord(
    'W4',
    undefined,
    undefined,
    { registerDate: '2026-10-08 10:00:00', reason: '地址不详', lastScanStationCode: 'S1' },
    undefined,
  )
  assert.equal(row.lastProblemDate, '2026-10-08 10:00:00')
  assert.equal(row.problemReason, '地址不详')
  assert.equal(row.lastScanSiteCode, 'S1')
})
