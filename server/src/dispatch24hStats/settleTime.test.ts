import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUS_TZ } from '../imile/ausTimezone'
import { isSettleTriggerDue, normalizeSettleTime } from './settleTime'

const tz = AUS_TZ.Adelaide

/** 2024-06-24 是冬令时（UTC+9:30），阿德莱德本地 16:00 = 06:30Z */
function atUtc(hhmm: string): Date {
  return new Date(`2024-06-24T${hhmm}:00.000Z`)
}

test('触发时刻按站点所属州的本地时间判定', () => {
  assert.equal(isSettleTriggerDue('16:00', tz, atUtc('06:30')), true) // 本地 16:00 整
  assert.equal(isSettleTriggerDue('16:00', tz, atUtc('06:44')), true) // 本地 16:14，补跑窗口内
  assert.equal(isSettleTriggerDue('16:00', tz, atUtc('06:45')), false) // 本地 16:15，窗口已过
  assert.equal(isSettleTriggerDue('16:00', tz, atUtc('06:29')), false) // 本地 15:59，还没到点
})

test('跨午夜的触发时刻不会漏掉补跑窗口', () => {
  // 本地 23:55 触发 → 本地次日 00:05（= 14:35Z）仍在窗口内
  assert.equal(isSettleTriggerDue('23:55', tz, atUtc('14:35')), true)
  assert.equal(isSettleTriggerDue('23:55', tz, atUtc('14:40')), false) // 本地 00:10，已过 15 分钟
})

test('脏数据回落默认 16:00，不让站点静默停摆', () => {
  assert.equal(normalizeSettleTime(''), '16:00')
  assert.equal(normalizeSettleTime('25:00'), '16:00')
  assert.equal(normalizeSettleTime(null), '16:00')
  assert.equal(normalizeSettleTime('08:05'), '08:05')
})
