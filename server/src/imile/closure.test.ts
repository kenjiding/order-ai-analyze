import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCloseExportQueryContent } from './closure'

test('buildCloseExportQueryContent 按约定拼装异步导出 queryContent', () => {
  const queryContent = buildCloseExportQueryContent({
    start: '2026-07-16 00:00:00',
    end: '2026-08-16 23:59:59',
    exceptionCloseReason: 'aus_Packet_loss_in_the_station',
  })
  assert.deepEqual(JSON.parse(queryContent), {
    selectAll: false,
    waybillNos: [],
    start: '2026-07-16 00:00:00',
    end: '2026-08-16 23:59:59',
    dateSearchType: 'end',
    exceptionCloseReason: 'aus_Packet_loss_in_the_station',
    auditStatus: 'finish',
    orderCode: '',
  })
})
