import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateDispatchDelivered, aggregateInventory } from './aggregate'

const TEMU_CODE = 'C2104008201'
const SHEIN_CODE = 'C2103904001'
const OTHER_CODE = 'C9999999999'

test('aggregateDispatchDelivered 按 clientCode 分出 Temu/Shein/其他', () => {
  const stat = aggregateDispatchDelivered({
    ofdRows: [
      { waybillNo: 'W1', hubCode: 'S1', clientCode: TEMU_CODE },
      { waybillNo: 'W2', hubCode: 'S1', clientCode: SHEIN_CODE },
      { waybillNo: 'W3', hubCode: 'S1', clientCode: OTHER_CODE },
    ],
    deliveredRows: [{ waybillNo: 'W1', hubCode: 'S1', driverCode: 'D1', clientCode: TEMU_CODE }],
    stationCodes: ['S1'],
  })
  assert.deepEqual(stat.dispatchBrand, { temu: 1, shein: 1, other: 1 })
  assert.deepEqual(stat.deliveredBrand, { temu: 1, shein: 0, other: 0 })
  assert.deepEqual(stat.byStation.S1.dispatchBrand, { temu: 1, shein: 1, other: 1 })
})

test('aggregateInventory 仓内/仓外各自按 clientCode 分出 Temu/Shein/其他', () => {
  const stat = aggregateInventory({
    pendingRows: [
      { inboundDate: '2026-01-01', ocCode: 'S1', clientCode: TEMU_CODE },
      { inboundDate: '2026-01-01', ocCode: 'S1', clientCode: OTHER_CODE },
    ],
    outboundRows: [{ deliveryStationCode: 'S1', clientCode: SHEIN_CODE }],
    stationCodes: ['S1'],
    todayDateStr: '2026-01-02',
  })
  assert.deepEqual(stat.inWarehouseBrand, { temu: 1, shein: 0, other: 1 })
  assert.deepEqual(stat.outWarehouseBrand, { temu: 0, shein: 1, other: 0 })
})
