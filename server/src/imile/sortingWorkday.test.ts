import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isDispatchDay,
  isNoSortingBatch,
  isSortingWorkday,
  lastSortingWorkdayOnOrBefore,
  MIN_SORTING_WAYBILLS,
  nextDispatchDayAfter,
  nextSortingWorkdayAfter,
  sortingWorkdayCatchUpDates,
  type RegionCalendarOverrides,
} from './sortingWorkday'

test('isNoSortingBatch: 值班零星扫描不构成批次', () => {
  assert.equal(isNoSortingBatch(0), true)
  assert.equal(isNoSortingBatch(30), true, '没开仓那天值班员工扫的几十单')
  assert.equal(isNoSortingBatch(MIN_SORTING_WAYBILLS - 1), true)
  assert.equal(isNoSortingBatch(MIN_SORTING_WAYBILLS), false)
  assert.equal(isNoSortingBatch(5000), false, '正常开仓日')
})

test('isNoSortingBatch: 按站点覆盖阈值，小站点体量低于全局默认也能正常判定', () => {
  // 真实场景：某站点全局默认(2000)以下的正常营业日(1553单)被误判成没开仓，
  // 站点配了自己的阈值(500)后应正确识别为开仓
  assert.equal(isNoSortingBatch(1553), true, '不传阈值时沿用全局默认，仍会被误判')
  assert.equal(isNoSortingBatch(1553, 500), false, '传入站点自己的阈值后不再误判')
  assert.equal(isNoSortingBatch(5, 500), true, '真正没开仓的天数，站点阈值下依然识别正确')
})

test('lastSortingWorkdayOnOrBefore: 告警目标日 —— 周末回退到周五，工作日取自己', () => {
  // 2026-07-06 周一 … 2026-07-12 周日
  assert.equal(lastSortingWorkdayOnOrBefore('2026-07-11'), '2026-07-10', '周六 → 周五')
  assert.equal(lastSortingWorkdayOnOrBefore('2026-07-12'), '2026-07-10', '周日 → 周五')
  assert.equal(
    lastSortingWorkdayOnOrBefore('2026-07-08'),
    '2026-07-08',
    '周三没开仓分拣时也不回退 —— 那天有没有批次由到件量判定，不由日历判',
  )
})

test('sortingWorkdayCatchUpDates：周一回溯目标日把中间跳过的周末也带上', () => {
  // 2026-07-06 周一 … 2026-07-12 周日
  assert.deepEqual(
    sortingWorkdayCatchUpDates('2026-07-12'),
    ['2026-07-10', '2026-07-11', '2026-07-12'],
    '周日 → 周五、周六、周日三天都要',
  )
  assert.deepEqual(sortingWorkdayCatchUpDates('2026-07-11'), ['2026-07-10', '2026-07-11'], '周六 → 周五、周六')
  assert.deepEqual(sortingWorkdayCatchUpDates('2026-07-08'), ['2026-07-08'], '工作日本身不回溯，退化成单日')
})

test('isSortingWorkday / isDispatchDay：不传 overrides 时都退化成纯周末判断，互不影响', () => {
  // 2026-07-06 周一 … 2026-07-12 周日
  assert.equal(isSortingWorkday('2026-07-08'), true)
  assert.equal(isSortingWorkday('2026-07-11'), false)
  assert.equal(isDispatchDay('2026-07-08'), true)
  assert.equal(isDispatchDay('2026-07-11'), false)
})

test('isSortingWorkday / isDispatchDay：两套日历各自独立覆盖，公共假期场景（分拣/派送停，早取照常）', () => {
  // 2026-07-08 周三是假期：分拣、派送都停摆，但早取服务照常——只覆盖派送日历
  const overrides: RegionCalendarOverrides = new Map([['2026-07-08', { isDispatchDay: false }]])
  assert.equal(isSortingWorkday('2026-07-08', overrides), true, '出仓日历不覆盖，早取服务照常')
  assert.equal(isDispatchDay('2026-07-08', overrides), false, '派送日历覆盖成停摆')
})

test('isSortingWorkday / isDispatchDay：周末临时开仓分拣场景，出仓开但司机未必加派', () => {
  // 2026-07-11 周六临时开仓分拣+出仓，司机没有跟着加派
  const overrides: RegionCalendarOverrides = new Map([['2026-07-11', { isExitDay: true }]])
  assert.equal(isSortingWorkday('2026-07-11', overrides), true, '出仓日历覆盖成开')
  assert.equal(isDispatchDay('2026-07-11', overrides), false, '派送日历没覆盖，沿用默认周末不派送')
})

test('nextSortingWorkdayAfter / nextDispatchDayAfter：假期覆盖后循环自动多跳一天，与周末叠加时继续往后找', () => {
  // 2026-07-06（周一）是假期：覆盖派送日历。上周五(07-03)的派送顺延目标要从「下周一」
  // 继续跳到周二(07-07)；出仓日历没被覆盖，不受影响。
  const overrides: RegionCalendarOverrides = new Map([['2026-07-06', { isDispatchDay: false }]])
  assert.equal(nextDispatchDayAfter('2026-07-03', overrides), '2026-07-07', '周一假期后循环多跳一天到周二')
  assert.equal(nextSortingWorkdayAfter('2026-07-03', overrides), '2026-07-06', '出仓日历不受派送覆盖影响')
})
