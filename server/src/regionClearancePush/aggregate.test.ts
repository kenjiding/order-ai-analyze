import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateDispatchDelivered, aggregateInventory } from './aggregate'

const TEMU_CODE = 'C2104008201'
const SHEIN_CODE = 'C2103904001'
const LOCAL_CODE = 'C1234500001'
const OTHER_CODE = 'C9999999999'
const PRIORITY_CODES = new Set([LOCAL_CODE])

test('aggregateDispatchDelivered 按 clientCode 分出 Temu/Shein/本地件/其他', () => {
  const stat = aggregateDispatchDelivered({
    ofdRows: [
      { waybillNo: 'W1', hubCode: 'S1', clientCode: TEMU_CODE },
      { waybillNo: 'W2', hubCode: 'S1', clientCode: SHEIN_CODE },
      { waybillNo: 'W3', hubCode: 'S1', clientCode: LOCAL_CODE },
      { waybillNo: 'W4', hubCode: 'S1', clientCode: OTHER_CODE },
    ],
    deliveredRows: [{ waybillNo: 'W1', hubCode: 'S1', driverCode: 'D1', clientCode: TEMU_CODE }],
    stationCodes: ['S1'],
    priorityClientCodes: PRIORITY_CODES,
  })
  assert.deepEqual(stat.dispatchBrand, { temu: 1, shein: 1, local: 1, other: 1 })
  assert.deepEqual(stat.deliveredBrand, { temu: 1, shein: 0, local: 0, other: 0 })
  assert.deepEqual(stat.byStation.S1.dispatchBrand, { temu: 1, shein: 1, local: 1, other: 1 })
})

test('aggregateInventory 仓内/仓外各自按 clientCode 分出 Temu/Shein/本地件/其他', () => {
  const stat = aggregateInventory({
    pendingRows: [
      { inboundDate: '2026-01-01', ocCode: 'S1', clientCode: TEMU_CODE },
      { inboundDate: '2026-01-01', ocCode: 'S1', clientCode: LOCAL_CODE },
      { inboundDate: '2026-01-01', ocCode: 'S1', clientCode: OTHER_CODE },
    ],
    outboundRows: [{ deliveryStationCode: 'S1', clientCode: SHEIN_CODE }],
    stationCodes: ['S1'],
    todayDateStr: '2026-01-02',
    priorityClientCodes: PRIORITY_CODES,
  })
  assert.deepEqual(stat.inWarehouseBrand, { temu: 1, shein: 0, local: 1, other: 1 })
  assert.deepEqual(stat.outWarehouseBrand, { temu: 0, shein: 1, local: 0, other: 0 })
})
