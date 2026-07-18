import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeInHubStockRange } from './inHubWaybillInventory'

// 需求给定：参考日 2026-07-18 时各天数区间的 start/end
test('computeInHubStockRange 对齐需求给定的映射表（基准日 2026-07-18）', () => {
  const D = '2026-07-18'
  assert.deepEqual(computeInHubStockRange(D, 2, 3), { start: '2026-07-15', end: '2026-07-16' })
  assert.deepEqual(computeInHubStockRange(D, 3, 4), { start: '2026-07-14', end: '2026-07-15' })
  assert.deepEqual(computeInHubStockRange(D, 4, 5), { start: '2026-07-13', end: '2026-07-14' })
})

test('computeInHubStockRange 跨月边界正确', () => {
  assert.deepEqual(computeInHubStockRange('2026-03-01', 1, 2), {
    start: '2026-02-27',
    end: '2026-02-28',
  })
})
