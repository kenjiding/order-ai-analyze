import assert from 'node:assert/strict'
import test from 'node:test'
import { isTimeRangeWithin31Days, mergePackageLossWaybillNos } from './packageLossMonitorRouter'

test('isTimeRangeWithin31Days 限制在 31 天内且结束时间不能早于开始时间', () => {
  assert.equal(isTimeRangeWithin31Days('2026-07-16 14:46:56', '2026-08-16 14:46:56'), true)
  assert.equal(isTimeRangeWithin31Days('2026-07-16 14:46:56', '2026-08-17 14:46:57'), false)
  assert.equal(isTimeRangeWithin31Days('2026-08-16 14:46:56', '2026-07-16 14:46:56'), false)
  assert.equal(isTimeRangeWithin31Days('', '2026-08-16 14:46:56'), false)
})

test('mergePackageLossWaybillNos 跨来源并集去重且忽略空白', () => {
  const merged = mergePackageLossWaybillNos(['A001', ' B002 ', ''], ['B002', 'C003', '  '])
  assert.deepEqual(merged.sort(), ['A001', 'B002', 'C003'])
})
