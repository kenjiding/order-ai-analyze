import assert from 'node:assert/strict'
import test from 'node:test'
import { AUS_TZ } from '../imile/ausTimezone'
import {
  addCalendarDays,
  aggregateExitRateRows,
  buildExitRateReport,
  enumerateDatesInclusive,
  HOUR_SLOT_COUNT,
  tagExitRateRows,
} from './aggregate'

const tz = AUS_TZ.Melbourne
const arrival = '2026-09-12'

function row(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    courierVendorCode: 'V1',
    courierVendor: '供应商甲',
    consigneeRouteCode: 'R1',
    courierCode: 'C1',
    courier: '张三',
    ...partial,
  }
}

test('enumerateDatesInclusive / addCalendarDays', () => {
  assert.deepEqual(enumerateDatesInclusive('2026-09-12', '2026-09-12'), ['2026-09-12'])
  assert.deepEqual(enumerateDatesInclusive('2026-09-12', '2026-09-14'), [
    '2026-09-12',
    '2026-09-13',
    '2026-09-14',
  ])
  assert.equal(addCalendarDays('2026-09-12', 1), '2026-09-13')
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01')
})

test('当天出仓：派件时间 ≤ 到件日 23:59:59', () => {
  const tagged = tagExitRateRows(
    [
      row({ deliveryTime: '2026-09-12 18:00:00' }),
      row({ deliveryTime: '2026-09-12 23:59:59' }),
      row({ deliveryTime: '2026-09-13 00:00:00' }),
    ],
    arrival,
    tz,
  )
  assert.equal(tagged[0]?.sameDay, true)
  assert.equal(tagged[0]?.nextMorning, false)
  assert.equal(tagged[0]?.hourIndex, 18)
  assert.equal(tagged[1]?.sameDay, true)
  assert.equal(tagged[1]?.hourIndex, 23)
  assert.equal(tagged[2]?.sameDay, false)
  assert.equal(tagged[2]?.nextMorning, true)
})

test('次日 0–11 点出仓：次日 00:00 起至 11:00 整点（含）', () => {
  const tagged = tagExitRateRows(
    [
      row({ deliveryTime: '2026-09-13 00:00:00' }),
      row({ deliveryTime: '2026-09-13 09:30:00' }),
      row({ deliveryTime: '2026-09-13 11:00:00' }),
      row({ deliveryTime: '2026-09-13 11:00:01' }),
      row({ deliveryTime: null }),
    ],
    arrival,
    tz,
  )
  assert.equal(tagged[0]?.nextMorning, true)
  assert.equal(tagged[0]?.hourIndex, 24)
  assert.equal(tagged[1]?.nextMorning, true)
  assert.equal(tagged[1]?.hourIndex, 33)
  assert.equal(tagged[2]?.nextMorning, true)
  assert.equal(tagged[2]?.sameDay, false)
  assert.equal(tagged[2]?.hourIndex, HOUR_SLOT_COUNT - 1)
  assert.equal(tagged[3]?.nextMorning, false)
  assert.equal(tagged[3]?.sameDay, false)
  assert.equal(tagged[3]?.hourIndex, null)
  assert.equal(tagged[4]?.pending, true)
  assert.equal(tagged[4]?.hourIndex, null)
})

test('按供应商 / 路由码 / 司机聚合占比', () => {
  const tagged = tagExitRateRows(
    [
      row({ deliveryTime: '2026-09-12 10:00:00' }),
      row({ deliveryTime: '2026-09-13 08:00:00', courierVendorCode: 'V2', courierVendor: '供应商乙' }),
      row({
        deliveryTime: null,
        courierVendorCode: 'V1',
        consigneeRouteCode: 'R2',
        courierCode: 'C2',
        courier: '李四',
      }),
    ],
    arrival,
    tz,
  )
  const agg = aggregateExitRateRows(tagged)
  assert.equal(agg.total, 3)
  assert.equal(agg.sameDay, 1)
  assert.equal(agg.nextMorning, 1)
  assert.equal(agg.pending, 1)
  assert.equal(agg.byHour[10], 1)
  assert.equal(agg.byHour[32], 1)

  const v1 = agg.vendors.find((v) => v.key === 'V1')
  const v2 = agg.vendors.find((v) => v.key === 'V2')
  assert.equal(v1?.total, 2)
  assert.equal(v1?.sameDay, 1)
  assert.equal(v1?.pending, 1)
  assert.equal(v1?.name, '供应商甲')
  assert.equal(v2?.total, 1)
  assert.equal(v2?.nextMorning, 1)

  const r1 = agg.routes.find((r) => r.key === 'R1')
  assert.equal(r1?.total, 2)
  const d1 = agg.drivers.find((d) => d.key === 'C1')
  assert.equal(d1?.name, '张三')
  assert.equal(d1?.total, 2)
})

test('多到件日按各自日历次日对齐小时桶', () => {
  const a = tagExitRateRows([row({ deliveryTime: '2026-09-13 09:00:00' })], '2026-09-12', tz)
  const b = tagExitRateRows([row({ deliveryTime: '2026-09-14 09:00:00' })], '2026-09-13', tz)
  assert.equal(a[0]?.hourIndex, 33)
  assert.equal(b[0]?.hourIndex, 33)
  const agg = aggregateExitRateRows([...a, ...b])
  assert.equal(agg.nextMorning, 2)
  assert.equal(agg.byHour[33], 2)
})

test('buildExitRateReport: 按到件日切开，合计等于分日之和', () => {
  const a = tagExitRateRows([row({ deliveryTime: '2026-09-12 18:00:00' })], '2026-09-12', tz)
  const b = tagExitRateRows(
    [row({ deliveryTime: '2026-09-14 09:00:00', courierVendorCode: 'V2', courierVendor: '供应商乙' })],
    '2026-09-13',
    tz,
  )
  const report = buildExitRateReport([
    { date: '2026-09-12', rows: a },
    { date: '2026-09-13', rows: b },
  ])
  assert.deepEqual(report.dates, ['2026-09-12', '2026-09-13'])
  assert.equal(report.byDate['2026-09-12']?.total, 1)
  assert.equal(report.byDate['2026-09-12']?.sameDay, 1)
  assert.equal(report.byDate['2026-09-13']?.nextMorning, 1)
  assert.equal(report.overall.total, 2)
  assert.equal(report.byDate['2026-09-12']?.vendors[0]?.key, 'V1')
  assert.equal(report.byDate['2026-09-13']?.vendors[0]?.key, 'V2')
})
