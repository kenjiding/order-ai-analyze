import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeStagnationRange } from './stagnantWaybills'
import { aggregateVendorStagnation, type BucketResult } from './chaseDispatchAggregate'

// 需求给定：基准日 2026-07-05 时各区间的 start/end
test('computeStagnationRange 对齐需求给定的映射表（基准日 2026-07-05）', () => {
  const D = '2026-07-05'
  assert.deepEqual(computeStagnationRange(D, '0-1'), { start: '2026-07-05', end: '' })
  assert.deepEqual(computeStagnationRange(D, '1-2'), { start: '2026-07-04', end: '2026-07-05' })
  assert.deepEqual(computeStagnationRange(D, '2-3'), { start: '2026-07-03', end: '2026-07-04' })
  assert.deepEqual(computeStagnationRange(D, '3-4'), { start: '2026-07-02', end: '2026-07-03' })
  assert.deepEqual(computeStagnationRange(D, '4-5'), { start: '2026-07-01', end: '2026-07-02' })
  assert.deepEqual(computeStagnationRange(D, '5-6'), { start: '2026-06-30', end: '2026-07-01' })
  assert.deepEqual(computeStagnationRange(D, '6-7'), { start: '2026-06-29', end: '2026-06-30' })
  assert.deepEqual(computeStagnationRange(D, '7+'), { start: '', end: '2026-06-29' })
})

test('computeStagnationRange 跨月边界正确', () => {
  assert.deepEqual(computeStagnationRange('2026-03-01', '1-2'), {
    start: '2026-02-28',
    end: '2026-03-01',
  })
})

test('aggregateVendorStagnation 按 driverVendorCode 过滤并跨区间去重', () => {
  const bucketResults: BucketResult[] = [
    {
      bucket: '0-1',
      rows: [
        { waybillNo: 'W1', driverVendorCode: 'V1', driverCode: 'D1', driverName: '张三' },
        { waybillNo: 'W2', driverVendorCode: 'V1', driverCode: 'D2', driverName: '李四' },
        { waybillNo: 'W9', driverVendorCode: 'V2', driverCode: 'D9', driverName: '别家' },
      ],
    },
    {
      bucket: '1-2',
      rows: [
        // W1 与 0-1 区间边界重叠，应去重
        { waybillNo: 'W1', driverVendorCode: 'V1', driverCode: 'D1', driverName: '张三' },
        { waybillNo: 'W3', driverVendorCode: 'V1', driverCode: 'D1', driverName: '张三' },
      ],
    },
  ]
  const summary = aggregateVendorStagnation(bucketResults, 'V1')
  // V1 去重后共 W1 W2 W3 = 3 单
  assert.equal(summary.totalStagnant, 3)
  // 0-1 区间 V1 有 W1 W2 = 2；1-2 区间 V1 有 W1 W3 = 2
  assert.deepEqual(
    summary.buckets.map((b) => [b.bucket, b.count]),
    [['0-1', 2], ['1-2', 2]],
  )
  // 按区间分别展示司机分布：0-1 区间 D1:W1=1、D2:W2=1；1-2 区间 D1:W1+W3=2（区间内不跨区间去重）
  assert.deepEqual(
    summary.buckets.map((b) => [b.bucket, b.drivers.map((d) => [d.driverCode, d.count])]),
    [
      ['0-1', [['D1', 1], ['D2', 1]]],
      ['1-2', [['D1', 2]]],
    ],
  )
})
