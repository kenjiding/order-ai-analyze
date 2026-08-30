import test from 'node:test'
import assert from 'node:assert/strict'
import { getRegionNow, localToUtcMs } from '../imile/inboundWaybillIndex'
import { AUS_TZ } from '../imile/ausTimezone'
import { resolveDueScheduledSlots } from './scheduledDueSlots'

const TZ = AUS_TZ.Adelaide
/** 阿德莱德 2026-03-04 11:00 本地时间 */
const SLOT_MS = localToUtcMs('2026-03-04 11:00:00', TZ)
const WEEKDAY = getRegionNow(TZ, new Date(SLOT_MS)).weekday
const PUSH_TIMES = [{ time: '11:00' }]

test('worker 漏跑：配置早已生效时，补跑窗口内仍能补发 11:00 槽', () => {
  const due = resolveDueScheduledSlots({
    tz: TZ,
    weekdays: [WEEKDAY],
    pushTimes: PUSH_TIMES,
    now: new Date(SLOT_MS + 10 * 60_000),
    effectiveSince: new Date(SLOT_MS - 24 * 60 * 60_000),
  })
  assert.deepEqual(
    due.map((s) => `${s.dateStr}|${s.timeHHmm}`),
    ['2026-03-04|11:00'],
  )
})

test('11:05 才启用/改配置：11:00 槽从未生效，不补发', () => {
  const due = resolveDueScheduledSlots({
    tz: TZ,
    weekdays: [WEEKDAY],
    pushTimes: PUSH_TIMES,
    now: new Date(SLOT_MS + 6 * 60_000),
    effectiveSince: new Date(SLOT_MS + 5 * 60_000),
  })
  assert.deepEqual(due, [])
})

test('保存时刻落在槽位那一分钟内（11:00:30）：11:00 槽仍然生效', () => {
  const due = resolveDueScheduledSlots({
    tz: TZ,
    weekdays: [WEEKDAY],
    pushTimes: PUSH_TIMES,
    now: new Date(SLOT_MS + 3 * 60_000),
    effectiveSince: new Date(SLOT_MS + 30_000),
  })
  assert.deepEqual(
    due.map((s) => s.timeHHmm),
    ['11:00'],
  )
})

test('槽位时刻本身：配置在同一分钟保存也照常推送，不受下界影响', () => {
  const due = resolveDueScheduledSlots({
    tz: TZ,
    weekdays: [WEEKDAY],
    pushTimes: PUSH_TIMES,
    now: new Date(SLOT_MS),
    effectiveSince: new Date(SLOT_MS),
  })
  assert.deepEqual(
    due.map((s) => s.timeHHmm),
    ['11:00'],
  )
})
