import assert from 'node:assert/strict'
import test from 'node:test'
import { AUS_TZ } from './ausTimezone'
import {
  buildExitAlarmZoneBreakdown,
  computeBefore11ThresholdMs,
  isBefore11Exit,
} from './before11Exit'

test('computeBefore11ThresholdMs: 到件日次日 11:00（州时区）', () => {
  const ms = computeBefore11ThresholdMs('2026-07-08', AUS_TZ.Adelaide)
  assert.equal(isBefore11Exit('2026-07-09 10:59:59', ms), true)
  assert.equal(isBefore11Exit('2026-07-09 11:00:00', ms), true)
  assert.equal(isBefore11Exit('2026-07-09 14:00:00', ms), false)
})

test('isBefore11Exit: 空派件时间未达标', () => {
  const ms = computeBefore11ThresholdMs('2026-07-08', AUS_TZ.Melbourne)
  assert.equal(isBefore11Exit(null, ms), false)
  assert.equal(isBefore11Exit('', ms), false)
})

test('buildExitAlarmZoneBreakdown: 11 点后派件计入 pending', () => {
  const ms = computeBefore11ThresholdMs('2026-07-08', AUS_TZ.Adelaide)
  const breakdown = buildExitAlarmZoneBreakdown(
    [
      { consigneeRouteCode: 'R1', deliveryTime: '2026-07-09 10:00:00' },
      { consigneeRouteCode: 'R1', deliveryTime: '2026-07-09 14:00:00' },
      { consigneeRouteCode: 'R1', deliveryTime: null },
    ],
    ms,
  )
  assert.deepEqual(breakdown.R1, { pending: 2, total: 3 })
})
