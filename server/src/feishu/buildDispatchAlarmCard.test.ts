import assert from 'node:assert/strict'
import test from 'node:test'
import { AUS_TZ } from '../imile/ausTimezone'
import { buildDispatchAlarmCard } from './buildDispatchAlarmCard'
import type { Dispatch24hDriverStat } from '../vendorAnalysis/dispatch24hAggregate'

type Card = { body: { elements: Array<{ content?: string }> } }

const bodyText = (card: unknown): string =>
  (card as Card).body.elements.map((el) => el.content ?? '').join('\n')

const unassignedBucket = (total: number): Dispatch24hDriverStat => ({
  courierCode: '',
  courierName: '',
  routeCode: 'R-A',
  total,
  met: 0,
  problemCount: 0,
  neverSignedCount: total,
  lateSignedCount: 0,
  priorityTotal: 0,
  priorityUnsigned: 0,
  neverSignedWaybills: [],
  lateSignedWaybills: [],
  problemWaybills: [],
})

const baseParams = {
  vendorName: 'iMile',
  stationCode: 'S210312',
  date: '2026-08-31',
  pushTime: '14:45',
  tz: AUS_TZ.Sydney,
  problemCount: 0,
  priorityTotal: 0,
  priorityUnsigned: 0,
  alertThresholdPct: 92,
}

test('未达标的单全部未派件（无司机）时，不能显示「全部已签收」', () => {
  const text = bodyText(
    buildDispatchAlarmCard({
      ...baseParams,
      total: 16,
      met: 0,
      drivers: [],
      unassigned: unassignedBucket(16),
    }),
  )

  assert.doesNotMatch(text, /All waybills signed within 24H/)
  assert.match(text, /Waybills not signed within 24H \(16\)/)
  assert.match(text, /Not dispatched \(no driver assigned\)/)
  assert.match(text, /16 not signed/)
})

test('真正全部达标时仍显示「全部已签收」', () => {
  const text = bodyText(
    buildDispatchAlarmCard({ ...baseParams, total: 16, met: 16, drivers: [], unassigned: null }),
  )

  assert.match(text, /All waybills signed within 24H/)
})

test('司机行展示「本地件优先客户」包裹数，不再展示问题件数', () => {
  const driver: Dispatch24hDriverStat = {
    courierCode: 'D21021044801',
    courierName: 'TIRTH THAKAR',
    routeCode: 'R-A',
    total: 132,
    met: 131,
    problemCount: 4,
    neverSignedCount: 1,
    lateSignedCount: 0,
    priorityTotal: 34,
    priorityUnsigned: 1,
    neverSignedWaybills: [],
    lateSignedWaybills: [],
    problemWaybills: [],
  }
  const text = bodyText(
    buildDispatchAlarmCard({ ...baseParams, total: 132, met: 131, problemCount: 4, drivers: [driver], unassigned: null }),
  )

  assert.match(text, /TIRTH THAKAR\*\* \(D21021044801\).*1 not signed.*\/ 132 total\. .*34 Priorities/)
  assert.doesNotMatch(text, /4 problem/)
})

test('KPI 行用「Priority Packages」磁贴取代问题件磁贴，展示未签收优先件 / 优先件总数', () => {
  // 磁贴文案嵌在 column_set 里，bodyText 只取顶层 content，这里整卡序列化后断言
  const text = JSON.stringify(
    buildDispatchAlarmCard({
      ...baseParams,
      total: 900,
      met: 890,
      problemCount: 7,
      priorityTotal: 590,
      priorityUnsigned: 439,
      drivers: [],
      unassigned: null,
    }),
  )

  assert.doesNotMatch(text, /Problem parcels/)
  assert.match(text, /\*\*Priority Packages\*\*/)
  assert.match(text, /\*\*439 not signed\*\*/)
  assert.match(text, /590 total/)
})
