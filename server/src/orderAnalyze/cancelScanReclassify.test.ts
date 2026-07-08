import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTrackEvent, type TrackEvent } from '../imile/track'
import {
  parseCancelScanTimestamp,
  pickLatestMatchingScan,
  reclassifyOutWarehouseLossWithCancelScan,
  resolveOutWarehouseResponsibilityStartTime,
} from './cancelScanReclassify'
import { deriveTrackFacts } from './trackFacts'
import type { OrderAnalyzeResult, TrackFacts } from './types'

function track(time: string, content: string): TrackEvent {
  return normalizeTrackEvent({ time, content })
}

function outWarehouseResult(orderNo: string, patch: Partial<OrderAnalyzeResult> = {}): OrderAnalyzeResult {
  return {
    orderNo,
    lossScope: '库外丢失',
    exceptionCategoryId: '快递员丢失',
    reason: '最终责任点为库外，距今超阈值',
    confidence: 0.9,
    currentResponsibilityParty: '某快递员',
    activeResponsibilityOwner: 'external_carrier',
    ...patch,
  }
}

function cancelScanRecord(input: {
  scanNumber: string
  scanDate: string
  operationResourceCode?: string | number
  scanType?: string
}): Record<string, unknown> {
  return {
    scanNumber: input.scanNumber,
    scanDate: input.scanDate,
    operationResourceCode: input.operationResourceCode ?? 2,
    scanType: input.scanType ?? '取消司机取件限制',
  }
}

test('parseCancelScanTimestamp 解析 ISO 与 d/m/yyyy 两种格式为可比较时间戳', () => {
  const iso = parseCancelScanTimestamp('2024-05-02 10:20:30')
  const slash = parseCancelScanTimestamp('2/5/2024 10:20:30')
  assert.equal(iso, slash)
  assert.equal(parseCancelScanTimestamp(''), null)
  assert.equal(parseCancelScanTimestamp(undefined), null)
})

test('pickLatestMatchingScan 仅匹配 operationResourceCode=2 且 scanType=取消司机取件限制，并取最新一条（保留原始字符串用于展示）', () => {
  const records = [
    cancelScanRecord({ scanNumber: 'A1', scanDate: '2024-05-01 08:00:00' }),
    cancelScanRecord({ scanNumber: 'A1', scanDate: '2024-05-03 08:00:00' }),
    cancelScanRecord({ scanNumber: 'A1', scanDate: '2024-05-09 08:00:00', operationResourceCode: 1 }),
    cancelScanRecord({ scanNumber: 'A1', scanDate: '2024-05-09 08:00:00', scanType: '其他扫描' }),
  ]
  const latest = pickLatestMatchingScan(records)
  assert.equal(latest?.timestamp, parseCancelScanTimestamp('2024-05-03 08:00:00'))
  assert.equal(latest?.raw, '2024-05-03 08:00:00')
})

test('resolveOutWarehouseResponsibilityStartTime 优先取 finalResponsibilityStartTime（out_warehouse 路径）', () => {
  const facts = { finalResponsibilityOwner: 'out_warehouse', finalResponsibilityStartTime: '2024-05-01 10:00:00', lastDispatchedOutTime: '2024-04-01 10:00:00' } as TrackFacts
  assert.equal(resolveOutWarehouseResponsibilityStartTime(facts), '2024-05-01 10:00:00')
})

test('resolveOutWarehouseResponsibilityStartTime 回退到 lastDispatchedOutTime（真实出库未回仓路径）', () => {
  const facts = { finalResponsibilityOwner: 'in_warehouse', finalResponsibilityStartTime: null, lastDispatchedOutTime: '2024-04-01 10:00:00' } as TrackFacts
  assert.equal(resolveOutWarehouseResponsibilityStartTime(facts), '2024-04-01 10:00:00')
})

test('库内扫描员在库外责任起算之后取消司机取件限制时改判为库内丢失', async () => {
  const dispatchTime = '2024-04-20 09:00:00'
  const facts = deriveTrackFacts([
    track('2024-04-19 09:00:00', '【ADL DS】包号[1]已到达。操作员【ADL-DC-Tong】 。'),
    track(dispatchTime, '【ADL DS】包裹正在派送中(派件员: ADL-JC-city-A,ID: D001,电话: ***)'),
  ], [], { analysisDate: '2024-05-20' })

  const orderNo = '6061026988935'
  const result = outWarehouseResult(orderNo)

  const { results, meta } = await reclassifyOutWarehouseLossWithCancelScan({
    results: [result],
    trackFacts: { [orderNo]: facts },
    imileToken: 'token',
    scanStationCode: 'S210431701',
    queryRecords: async (input) => {
      assert.deepEqual(input.scanNumbers, [orderNo])
      return {
        ok: true,
        raw: null,
        records: [
          cancelScanRecord({ scanNumber: orderNo, scanDate: '2024-04-25 12:00:00' }),
        ],
      }
    },
  })

  assert.equal(meta.checkedOrderNos.length, 1)
  assert.deepEqual(meta.reclassifiedOrderNos, [orderNo])
  const reclassified = results[0]
  assert.equal(reclassified.lossScope, '库内丢失')
  assert.equal(reclassified.exceptionCategoryId, '扫描员丢失')
  assert.equal(reclassified.needsReview, false)
  assert.equal(reclassified.activeResponsibilityOwner, 'company_warehouse')
  assert.equal(reclassified.latestResponsibilityTrackMarker, null)
  assert.match(reclassified.reason, /^\[取消扫描核验纠正]/)
  assert.equal(reclassified.appliedDecisionRuleId, 'cancel_scan_driver_pickup_restriction_reassigns_in_warehouse')
  // 展示时间必须原样使用接口返回的 scanDate 字符串，不能经 Date 反格式化产生时区偏差（如 ISO Z 格式）
  assert.match(reclassified.reason, /库内扫描员在 2024-04-25 12:00:00 执行/)
  assert.doesNotMatch(reclassified.reason, /\dZ/)
})

test('取消扫描时间早于库外责任起算时间时维持库外丢失原判', async () => {
  const dispatchTime = '2024-04-20 09:00:00'
  const facts = deriveTrackFacts([
    track('2024-04-19 09:00:00', '【ADL DS】包号[1]已到达。操作员【ADL-DC-Tong】 。'),
    track(dispatchTime, '【ADL DS】包裹正在派送中(派件员: ADL-JC-city-A,ID: D001,电话: ***)'),
  ], [], { analysisDate: '2024-05-20' })

  const orderNo = '6061026988935'
  const result = outWarehouseResult(orderNo)

  const { results, meta } = await reclassifyOutWarehouseLossWithCancelScan({
    results: [result],
    trackFacts: { [orderNo]: facts },
    imileToken: 'token',
    queryRecords: async () => ({
      ok: true,
      raw: null,
      records: [cancelScanRecord({ scanNumber: orderNo, scanDate: '2024-04-15 12:00:00' })],
    }),
  })

  assert.deepEqual(meta.reclassifiedOrderNos, [])
  assert.deepEqual(results[0], result)
})

test('取消扫描记录不属于该订单或不满足条件时不改判', async () => {
  const dispatchTime = '2024-04-20 09:00:00'
  const facts = deriveTrackFacts([
    track('2024-04-19 09:00:00', '【ADL DS】包号[1]已到达。操作员【ADL-DC-Tong】 。'),
    track(dispatchTime, '【ADL DS】包裹正在派送中(派件员: ADL-JC-city-A,ID: D001,电话: ***)'),
  ], [], { analysisDate: '2024-05-20' })

  const orderNo = '6061026988935'
  const result = outWarehouseResult(orderNo)

  const { results, meta } = await reclassifyOutWarehouseLossWithCancelScan({
    results: [result],
    trackFacts: { [orderNo]: facts },
    imileToken: 'token',
    queryRecords: async () => ({
      ok: true,
      raw: null,
      records: [
        cancelScanRecord({ scanNumber: 'OTHER_ORDER', scanDate: '2024-04-25 12:00:00' }),
        cancelScanRecord({ scanNumber: orderNo, scanDate: '2024-04-25 12:00:00', operationResourceCode: 1 }),
      ],
    }),
  })

  assert.deepEqual(meta.reclassifiedOrderNos, [])
  assert.deepEqual(results[0], result)
})

test('非库外丢失订单不参与核验查询', async () => {
  const result: OrderAnalyzeResult = {
    orderNo: 'IN1',
    lossScope: '库内丢失',
    exceptionCategoryId: '扫描员丢失',
    reason: '库内超时',
    confidence: 0.9,
  }

  let called = false
  const { results, meta } = await reclassifyOutWarehouseLossWithCancelScan({
    results: [result],
    trackFacts: {},
    imileToken: 'token',
    queryRecords: async () => {
      called = true
      return { ok: true, raw: null, records: [] }
    },
  })

  assert.equal(called, false)
  assert.deepEqual(meta, { checkedOrderNos: [], reclassifiedOrderNos: [] })
  assert.deepEqual(results, [result])
})

test('取消扫描接口调用失败时维持原判并在 meta 中透出错误', async () => {
  const orderNo = 'OUT1'
  const result = outWarehouseResult(orderNo)

  const { results, meta } = await reclassifyOutWarehouseLossWithCancelScan({
    results: [result],
    trackFacts: {},
    imileToken: 'token',
    queryRecords: async () => ({ ok: false, status: 502, message: '网络异常' }),
  })

  assert.deepEqual(results, [result])
  assert.equal(meta.error, '网络异常')
  assert.deepEqual(meta.checkedOrderNos, [orderNo])
  assert.deepEqual(meta.reclassifiedOrderNos, [])
})

test('缺少责任起算时间（facts 缺失）时跳过该订单不改判', async () => {
  const orderNo = 'OUT2'
  const result = outWarehouseResult(orderNo)

  const { results, meta } = await reclassifyOutWarehouseLossWithCancelScan({
    results: [result],
    trackFacts: {},
    imileToken: 'token',
    queryRecords: async () => ({
      ok: true,
      raw: null,
      records: [cancelScanRecord({ scanNumber: orderNo, scanDate: '2024-04-25 12:00:00' })],
    }),
  })

  assert.deepEqual(meta.reclassifiedOrderNos, [])
  assert.deepEqual(results[0], result)
})
