import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapJanusRowToWaybillRecord, mergeJanusWaybillResults } from './inboundWaybillIndex'

test('Janus 行 → searchWaybill 同名字段：deliveryTime 取最新派件优先，signDate 取签收，未签收为 null', () => {
  const row = mapJanusRowToWaybillRecord({
    waybill_no: 'W1',
    first_delivery_date: '2026-10-08 08:00:00',
    last_delivery_date: '2026-10-08 09:00:00',
    delivered_date: '2026-10-08 12:00:00',
    courier_code: 'D1',
    courier: '张三',
    dispatch_vendor_code: 'V1',
    consignee_route_code: 'R1',
    client_code: 'C1',
    consignee_zip_code: '5000',
    consignee_city: 'ADELAIDE',
    last_problem_date: '',
  })
  assert.deepEqual(
    [row.waybillNo, row.deliveryTime, row.signDate, row.courierCode, row.courier, row.courierVendorCode],
    ['W1', '2026-10-08 09:00:00', '2026-10-08 12:00:00', 'D1', '张三', 'V1'],
  )
  assert.deepEqual([row.consigneeRouteCode, row.clientCode, row.consigneeZipCode, row.consigneeCity], ['R1', 'C1', '5000', 'ADELAIDE'])
  assert.equal(row.lastProblemDate, null)
})

test('没有 last_delivery_date 时回退 first_delivery_date；两者都空则 deliveryTime 为 null', () => {
  const withFirstOnly = mapJanusRowToWaybillRecord({ waybill_no: 'W2', first_delivery_date: '2026-10-08 08:00:00' })
  assert.equal(withFirstOnly.deliveryTime, '2026-10-08 08:00:00')

  const withNeither = mapJanusRowToWaybillRecord({ waybill_no: 'W3' })
  assert.equal(withNeither.deliveryTime, null)
  assert.equal(withNeither.signDate, null)
})

test('Janus 还没同步到的单号用占位行兜底，不能从结果里整条消失（否则会被 selectWaybillNosNeedingRefresh/聚合悄悄漏计）', () => {
  const janusByNo = new Map([['W1', { waybill_no: 'W1', last_delivery_date: '2026-10-08 09:00:00' }]])
  const records = mergeJanusWaybillResults(['W1', 'W2'], janusByNo)
  assert.equal(records.length, 2)
  assert.equal(records[0].waybillNo, 'W1')
  assert.equal(records[0].deliveryTime, '2026-10-08 09:00:00')
  // W2 没在 Janus 结果里：仍要占一条位，deliveryTime/signDate 为空、不是「终态」，下一轮会继续重拉
  assert.equal(records[1].waybillNo, 'W2')
  assert.equal(records[1].deliveryTime, null)
  assert.equal(records[1].signDate, null)
})
