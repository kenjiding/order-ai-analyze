import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDeliveryWeather } from './deliveryWeatherSummary'
import type { BomDailyForecast } from './types'

const day = (over: Partial<BomDailyForecast>): BomDailyForecast => ({
  date: '2026-01-01T00:00:00Z',
  icon_descriptor: 'sunny',
  ...over,
})

test('高温分级：35/38/40°C 三档', () => {
  const forecast = [day({}), day({ temp_max: 36 }), day({ temp_max: 41 })]
  const block = buildDeliveryWeather(forecast, 'Adelaide')
  assert.equal(block?.days[0].impactLevel, 'mild')
  assert.match(block!.days[0].impactLabel, /Hot day/)
  assert.equal(block?.days[1].impactLevel, 'severe')
  assert.match(block!.days[1].impactLabel, /Extreme heat/)
})

test('高温与降雨同级时合并文案，取更高等级时只用更高的', () => {
  const forecast = [
    day({}),
    // moderate 降雨 + moderate 高温(38) → 同级合并
    day({ icon_descriptor: 'rain', rain: { chance: 60 }, temp_max: 38 }),
    // severe 暴雨 + mild 高温(35) → 暴雨等级更高，只保留暴雨文案
    day({ icon_descriptor: 'storm', temp_max: 35 }),
  ]
  const block = buildDeliveryWeather(forecast, 'Adelaide')
  assert.equal(block?.days[0].impactLevel, 'moderate')
  assert.match(block!.days[0].impactLabel, /Rain/)
  assert.match(block!.days[0].impactLabel, /High heat/)
  assert.equal(block?.days[1].impactLevel, 'severe')
  assert.doesNotMatch(block!.days[1].impactLabel, /heat/i)
})

test('低于 35°C 不触发高温提醒', () => {
  const forecast = [day({}), day({ temp_max: 34 }), day({ temp_max: null })]
  const block = buildDeliveryWeather(forecast, 'Adelaide')
  assert.equal(block?.days[0].impactLevel, 'normal')
  assert.equal(block?.days[1].impactLevel, 'normal')
})
