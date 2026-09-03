import assert from 'node:assert/strict'
import test from 'node:test'
import { AUS_TZ } from '../imile/ausTimezone'
import { buildExitAlarmCard } from './buildExitAlarmCard'

/** 磁贴文案嵌在 column_set 里，直接整卡序列化后做文本断言 */
const bodyText = (card: unknown): string => JSON.stringify(card)

const baseParams = {
  vendorName: 'iMile',
  stationCode: 'S210312',
  date: '2026-09-03',
  pushTime: '11:00',
  tz: AUS_TZ.Adelaide,
  zoneBreakdown: { 'R-A': { pending: 100, total: 300 } },
  totalPending: 100,
  totalWaybills: 300,
}

test('配置清货价时在 KPI 行展示清货费用磁贴', () => {
  const text = bodyText(buildExitAlarmCard({ ...baseParams, clearancePrice: 1.25 }))
  assert.match(text, /\*\*Clearance cost\*\*/)
  assert.match(text, /\$125\.00/)
})

test('未配置清货价 / 无滞留件时不展示清货费用', () => {
  assert.doesNotMatch(bodyText(buildExitAlarmCard(baseParams)), /Clearance cost/)
  const noPending = {
    ...baseParams,
    zoneBreakdown: { 'R-A': { pending: 0, total: 300 } },
    totalPending: 0,
    clearancePrice: 1.25,
  }
  assert.doesNotMatch(bodyText(buildExitAlarmCard(noPending)), /Clearance cost/)
})
