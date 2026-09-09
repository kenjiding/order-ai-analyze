import assert from 'node:assert/strict'
import test from 'node:test'
import { AUS_TZ } from './ausTimezone'
import { computeBefore11ThresholdMs, computeThresholdMsOnDate, isBefore11Exit } from './before11Exit'

test('computeBefore11ThresholdMs: 到件日次日 11:00（州时区）', () => {
  const ms = computeBefore11ThresholdMs('2026-07-08', AUS_TZ.Adelaide)
  assert.equal(isBefore11Exit('2026-07-09 10:59:59', ms), true)
  assert.equal(isBefore11Exit('2026-07-09 11:00:00', ms), true)
  assert.equal(isBefore11Exit('2026-07-09 14:00:00', ms), false)
})

test('computeBefore11ThresholdMs: 周五/六/日到件截止下周一 11:00', () => {
  // 2026-07-10 周五 → 2026-07-13 周一 11:00（iMile 派件时间是墨尔本本地，用 14:00 避开州时差）
  const friday = computeBefore11ThresholdMs('2026-07-10', AUS_TZ.Adelaide)
  assert.equal(isBefore11Exit('2026-07-11 12:00:00', friday), true, '周六出仓仍在下周一 11:00 之前')
  assert.equal(isBefore11Exit('2026-07-13 10:00:00', friday), true)
  assert.equal(isBefore11Exit('2026-07-13 14:00:00', friday), false)
  const saturday = computeBefore11ThresholdMs('2026-07-11', AUS_TZ.Adelaide)
  const sunday = computeBefore11ThresholdMs('2026-07-12', AUS_TZ.Adelaide)
  assert.equal(saturday, friday)
  assert.equal(sunday, friday)
})

test('isBefore11Exit: 空派件时间未达标', () => {
  const ms = computeBefore11ThresholdMs('2026-07-08', AUS_TZ.Melbourne)
  assert.equal(isBefore11Exit(null, ms), false)
  assert.equal(isBefore11Exit('', ms), false)
})

test('computeThresholdMsOnDate: 阈值锚在传入日期本身，不做次日推导', () => {
  // 2026-08-10 是周一；出仓告警到件日跨周末回退到上周五 2026-08-07 时，
  // 阈值不能再用「到件日+1天」（会落到早已过去的周六 2026-08-08），
  // 必须直接用推送触发当天（今天）+ 推送时刻。
  const ms = computeThresholdMsOnDate('2026-08-10', AUS_TZ.Adelaide, '15:00')
  assert.equal(isBefore11Exit('2026-08-10 09:00:00', ms), true, '今早已出仓应判定为达标')
  assert.equal(isBefore11Exit('2026-08-10 16:00:00', ms), false, '推送时刻之后才出仓应判定为未达标')
  // 用「到件日+1天」算的旧阈值（周六）会把今早的出仓也误判为未达标，锁住不能回退到这个算法
  const staleMs = computeThresholdMsOnDate('2026-08-08', AUS_TZ.Adelaide, '15:00')
  assert.equal(isBefore11Exit('2026-08-10 09:00:00', staleMs), false, '旧算法证伪：不应再用到件日+1天')
})
