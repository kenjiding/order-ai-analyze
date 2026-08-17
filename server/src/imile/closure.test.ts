import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCloseSearchPayload, extractClosedPacketLossWaybillNos } from './closure'

test('buildCloseSearchPayload 按约定拼装 close/search 参数', () => {
  const payload = buildCloseSearchPayload({
    start: '2026-07-16 14:46:56',
    end: '2026-08-16 14:46:56',
    currentPage: 2,
    showCount: 1000,
    exceptionCloseReason: 'aus_Packet_loss_in_the_station',
  })
  assert.deepEqual(payload, {
    auditStatus: 'finish',
    currentPage: 2,
    dateSearchType: 'end',
    end: '2026-08-16 14:46:56',
    exceptionCloseReason: 'aus_Packet_loss_in_the_station',
    orderCode: '',
    selectAll: false,
    showCount: 1000,
    start: '2026-07-16 14:46:56',
    waybillNos: [],
  })
})

test('extractClosedPacketLossWaybillNos 提取并去重 waybillNo', () => {
  const records = [
    { waybillNo: 'A001' },
    { waybillNo: 'A001' },
    { waybillNo: ' B002 ' },
    { waybillNo: '' },
    { orderNo: 'NOPE' },
    null,
  ]
  assert.deepEqual(extractClosedPacketLossWaybillNos(records).sort(), ['A001', 'B002'])
})
