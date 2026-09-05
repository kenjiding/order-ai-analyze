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
  zoneBreakdown: { 'R-A': { pending: 100, total: 300, priority: 34, priorityExited: 30 } },
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
    zoneBreakdown: { 'R-A': { pending: 0, total: 300, priority: 0, priorityExited: 0 } },
    totalPending: 0,
    clearancePrice: 1.25,
  }
  assert.doesNotMatch(bodyText(buildExitAlarmCard(noPending)), /Clearance cost/)
})

test('路由磁贴首行展示「本地件优先客户」包裹数，不再展示未出仓件数', () => {
  const text = bodyText(buildExitAlarmCard(baseParams))
  assert.match(text, /\*\*R-A\*\* - .*34 Priorities/)
  assert.doesNotMatch(text, /100 not exited/)
})

test('KPI 行在 Exit rate 右侧展示「Priority Packages」磁贴，取各路由优先件之和', () => {
  const text = bodyText(
    buildExitAlarmCard({
      ...baseParams,
      zoneBreakdown: { 'R-A': { pending: 100, total: 300, priority: 34, priorityExited: 30 }, 'R-B': { pending: 5, total: 50, priority: 22, priorityExited: 20 } },
    }),
  )
  assert.match(text, /\*\*Priority Packages\*\*/)
  // 主数字为未出仓优先件 (34+22)-(30+20)=6，副行为优先件总数 56
  assert.match(text, /\*\*6 Not exited\*\*/)
  assert.match(text, /56 total/)
})
