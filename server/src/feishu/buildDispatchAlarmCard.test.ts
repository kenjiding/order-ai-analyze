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
