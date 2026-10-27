import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUS_TZ, imileTimezoneOffsetHeader } from './ausTimezone'

test('imileTimezoneOffsetHeader：墨尔本夏令时期间返回 +11，非夏令时返回 +10', () => {
  // 2026-10-23 已进入夏令时（2026 年从 10-04 开始）
  assert.equal(imileTimezoneOffsetHeader(AUS_TZ.Melbourne, new Date('2026-10-23T01:00:00Z')), '+11')
  // 2026-06-15 是冬天，非夏令时
  assert.equal(imileTimezoneOffsetHeader(AUS_TZ.Melbourne, new Date('2026-06-15T01:00:00Z')), '+10')
})

test('imileTimezoneOffsetHeader：奥克兰夏令时期间返回 +13，非夏令时返回 +12', () => {
  // 2026-10-23 已进入夏令时（2026 年从 09-27 开始）
  assert.equal(imileTimezoneOffsetHeader(AUS_TZ.Auckland, new Date('2026-10-23T01:00:00Z')), '+13')
  assert.equal(imileTimezoneOffsetHeader(AUS_TZ.Auckland, new Date('2026-06-15T01:00:00Z')), '+12')
})
