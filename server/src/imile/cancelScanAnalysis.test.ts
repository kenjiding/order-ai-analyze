import assert from 'node:assert/strict'
import test from 'node:test'
import { MISASSIGNED_COURIER_SCAN_TYPE } from './cancelScanAnalysis'

/**
 * analyzeCancelScan 内联过滤逻辑的等价实现：验证「只有 scanType=取消分配派件员
 * 的记录才算分错」这一条规则本身是对的，避免依赖网络请求跑整个函数。
 */
function isMisassignedCourierRecord(record: unknown): boolean {
  if (typeof record !== 'object' || record === null) return false
  return String((record as Record<string, unknown>).scanType ?? '').trim() === MISASSIGNED_COURIER_SCAN_TYPE
}

test('只保留 scanType=取消分配派件员 的记录，其余取消扫描原因不计入分错', () => {
  const records = [
    { scanNumber: 'A1', scanType: '取消分配派件员' },
    { scanNumber: 'A2', scanType: '取消司机取件限制' },
    { scanNumber: 'A3', scanType: '' },
  ]
  const filtered = records.filter(isMisassignedCourierRecord)
  assert.deepEqual(filtered.map((r) => r.scanNumber), ['A1'])
})
