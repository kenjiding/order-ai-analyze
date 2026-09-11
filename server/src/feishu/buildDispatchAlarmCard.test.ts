import assert from 'node:assert/strict'
import test from 'node:test'
import { AUS_TZ } from '../imile/ausTimezone'
import { buildDispatchAlarmCard, buildDispatchAlarmRankingCard, rankDispatch24h } from './buildDispatchAlarmCard'
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

test('排名：率高在前，同率单量大在前，不足 30 单不参与名次且排最后', () => {
  const entries = rankDispatch24h([
    { key: 'a', name: 'A', total: 100, met: 90 },
    { key: 'b', name: 'B', total: 200, met: 190 },
    { key: 'c', name: 'C', total: 100, met: 95 },
    { key: 'd', name: 'D', total: 10, met: 10 },
  ])

  assert.deepEqual(
    entries.map((e) => [e.key, e.rank]),
    [['b', 1], ['c', 2], ['a', 3], ['d', null]],
  )
})

test('实时排名卡：标题用站点名，前三名金银铜按名次排列，低于阈值的率标红，样本不足单独列在最后', () => {
  // 行在 column_set 里，bodyText 只取顶层 content，这里整卡序列化后断言
  const text = JSON.stringify(
    buildDispatchAlarmRankingCard({
      stationName: 'Adelaide',
      date: '2026-08-31',
      pushTime: '14:45',
      tz: AUS_TZ.Sydney,
      alertThresholdPct: 92,
      entries: rankDispatch24h([
        { key: 'b', name: 'ADL-Lu', total: 300, met: 270 },
        { key: 'a', name: 'ADL-City', total: 400, met: 388 },
        { key: 'd', name: 'MEL-East', total: 200, met: 188 },
        { key: 'e', name: 'MEL-West', total: 100, met: 80 },
        { key: 'c', name: 'Tiny', total: 5, met: 1 },
      ]),
    }),
  )
  const pos = (s: string) => text.indexOf(s)

  assert.match(text, /"content":"🏆 Delivery Live Ranking · Adelaide"/)
  // 名次单独一列放大：奖牌/数字在前，供应商名紧随其后
  assert.ok(pos('"content":"🥇"') >= 0)
  assert.ok(pos('"content":"🥇"') < pos('**ADL-City**'))
  assert.ok(pos('**ADL-City**') < pos('"content":"🥈"'))
  assert.ok(pos('"content":"🥈"') < pos('**MEL-East**'))
  assert.ok(pos('**MEL-East**') < pos('"content":"🥉"'))
  assert.ok(pos('"content":"🥉"') < pos('**ADL-Lu**'))
  assert.ok(pos('**ADL-Lu**') < pos('"content":"**4**"'))
  assert.ok(pos('"content":"**4**"') < pos('**MEL-West**'))
  assert.match(text, /"content":"🥇","text_align":"center","text_size":"xx-large"/)
  assert.match(text, /"content":"\*\*4\*\*","text_align":"center","text_size":"xx-large"/)
  assert.match(text, /<font color='green'>\*\*97\.0%\*\*<\/font>/)
  assert.match(text, /<font color='red'>\*\*90\.0%\*\*<\/font>/)
  // 卡片全英文：整卡不能出现任何中文
  assert.doesNotMatch(text, /[一-鿿]/)
  // 单行紧凑：未签收与供应商名同一行，不换行
  // 每行只展示名次、供应商名、派签率，不展示未签收件数
  assert.match(text, /"content":"\*\*ADL-City\*\*"/)
  assert.doesNotMatch(text, /not signed/)
  assert.match(text, /Threshold 92%/)
  // 整行一个色块：底色只挂在 column_set 上一次，不再每列各铺一块
  assert.equal(text.split('"background_style":"yellow-50"').length - 1, 1)
  assert.match(text, /"tag":"column_set","flex_mode":"none","horizontal_spacing":"0px","background_style":"yellow-50"/)
  // 不能有可点击的交互容器，否则点击会出现 loading
  assert.doesNotMatch(text, /interactive_container|"behaviors"/)
  assert.ok(pos('**Tiny**') > pos('Not ranked ('))
  assert.ok(pos('Not ranked (') > pos('**MEL-West**'))
})
