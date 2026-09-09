import assert from 'node:assert/strict'
import test from 'node:test'
import { isNoSortingBatch, lastSortingWorkdayOnOrBefore, MIN_SORTING_WAYBILLS } from './sortingWorkday'

test('isNoSortingBatch: 值班零星扫描不构成批次', () => {
  assert.equal(isNoSortingBatch(0), true)
  assert.equal(isNoSortingBatch(30), true, '没开仓那天值班员工扫的几十单')
  assert.equal(isNoSortingBatch(MIN_SORTING_WAYBILLS - 1), true)
  assert.equal(isNoSortingBatch(MIN_SORTING_WAYBILLS), false)
  assert.equal(isNoSortingBatch(5000), false, '正常开仓日')
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
