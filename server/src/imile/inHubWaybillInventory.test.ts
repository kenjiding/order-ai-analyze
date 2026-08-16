import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeInHubStockRange,
  IN_HUB_PACKAGE_LOSS_QUERIES,
  mergeWaybillNosByScanType,
} from './inHubWaybillInventory'

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

test('mergeWaybillNosByScanType 合并去重并保留各组计数', () => {
  const merged = mergeWaybillNosByScanType([
    { scanType: '1504', waybillNos: ['A', 'B', 'A', '  '] },
    { scanType: '400', waybillNos: ['B', 'C'] },
  ])
  assert.equal(merged.byScanType['1504'], 2)
  assert.equal(merged.byScanType['400'], 2)
  assert.equal(merged.total, 3)
  assert.deepEqual([...merged.waybillNos].sort(), ['A', 'B', 'C'])
})

test('mergeWaybillNosByScanType 单侧为空时另一侧仍可用', () => {
  const merged = mergeWaybillNosByScanType([
    { scanType: '1504', waybillNos: [] },
    { scanType: '400', waybillNos: ['X'] },
  ])
  assert.equal(merged.byScanType['1504'], 0)
  assert.equal(merged.byScanType['400'], 1)
  assert.deepEqual(merged.waybillNos, ['X'])
})

test('IN_HUB_PACKAGE_LOSS_QUERIES 覆盖未关闭/已关闭 × 1504/400', () => {
  assert.deepEqual(
    [...IN_HUB_PACKAGE_LOSS_QUERIES],
    [
      { scanType: '1504', stockReportType: 'notClosed' },
      { scanType: '400', stockReportType: 'notClosed' },
      { scanType: '1504', stockReportType: 'closed' },
      { scanType: '400', stockReportType: 'closed' },
    ],
  )
})

test('mergeWaybillNosByScanType 同 scanType 的未关闭与已关闭并集去重', () => {
  const merged = mergeWaybillNosByScanType([
    { scanType: '1504', waybillNos: ['A', 'B'] },
    { scanType: '400', waybillNos: ['B'] },
    { scanType: '1504', waybillNos: ['B', 'C'] },
    { scanType: '400', waybillNos: ['D'] },
  ])
  assert.equal(merged.byScanType['1504'], 3)
  assert.equal(merged.byScanType['400'], 2)
  assert.equal(merged.total, 4)
  assert.deepEqual([...merged.waybillNos].sort(), ['A', 'B', 'C', 'D'])
})
