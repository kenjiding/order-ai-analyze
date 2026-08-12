import assert from 'node:assert/strict'
import test from 'node:test'
import { enrichTheftSuspectDriverVendor, type QueryDriverVendorFn } from './driverVendorEnrich'
import type { OrderAnalyzeResult, TrackFacts } from './types'

function theftResult(patch: Partial<OrderAnalyzeResult> = {}): OrderAnalyzeResult {
  return {
    orderNo: 'T1',
    lossScope: '库内丢失',
    exceptionCategoryId: '疑似派件员窃取',
    reason: '库内超时且存在分配-取消循环',
    confidence: 0.92,
    needsReview: false,
    ...patch,
  }
}

function factsWithDriver(driverName: string, driverId = ''): Record<string, TrackFacts> {
  return {
    T1: {
      firstAssignCancelDriver: {
        driverName,
        driverId,
        assignTime: '2026-07-28 10:15:03',
        cancelTime: '2026-07-28 18:48:21',
        cancelDriverName: driverName,
      },
    } as unknown as TrackFacts,
  }
}

/** 断言判定结论字段一个都没被富化阶段改动。 */
function assertVerdictUnchanged(actual: OrderAnalyzeResult, expected: OrderAnalyzeResult): void {
  assert.equal(actual.lossScope, expected.lossScope)
  assert.equal(actual.exceptionCategoryId, expected.exceptionCategoryId)
  assert.equal(actual.reason, expected.reason)
  assert.equal(actual.confidence, expected.confidence)
  assert.equal(actual.needsReview, expected.needsReview)
  assert.equal(actual.latestResponsibility, expected.latestResponsibility)
}

test('精确匹配时写入供应商，且不改动判定结论', async () => {
  const input = theftResult()
  const query: QueryDriverVendorFn = async () => ({
    ok: true,
    matches: [
      { driverId: 'D9', driverName: '其他人', vendorCode: 'V9', vendorName: '干扰供应商' },
      { driverId: 'D1', driverName: 'ADL-KAS-Parth', vendorCode: 'V1', vendorName: '正确供应商' },
    ],
    exact: { driverId: 'D1', driverName: 'ADL-KAS-Parth', vendorCode: 'V1', vendorName: '正确供应商' },
  })

  const { results, meta } = await enrichTheftSuspectDriverVendor({
    results: [input],
    trackFacts: factsWithDriver('ADL-KAS-Parth'),
    imileToken: 'tok',
    queryDriverVendor: query,
  })

  assertVerdictUnchanged(results[0], input)
  assert.equal(meta.enrichedOrderNos.length, 1)
  assert.deepEqual(results[0].extraData?.entries, [
    { label: '首个嫌疑派件员', value: 'ADL-KAS-Parth' },
    { label: '首次分配时间', value: '2026-07-28 10:15:03' },
    { label: '对应取消时间', value: '2026-07-28 18:48:21' },
    { label: '司机ID', value: 'D1' },
    { label: '所属供应商', value: '正确供应商 (V1)' },
  ])
  assert.equal(results[0].extraData?.summary, '首个嫌疑派件员：ADL-KAS-Parth｜供应商：正确供应商 (V1)')
})

test('按名字命中多条且无精确匹配时标注不确定，不硬取第一条', async () => {
  const input = theftResult()
  const query: QueryDriverVendorFn = async () => ({
    ok: true,
    matches: [
      { driverId: 'D1', driverName: 'PARB 001', vendorCode: 'V1', vendorName: '供应商甲' },
      { driverId: 'D2', driverName: 'PARB 002', vendorCode: 'V2', vendorName: '供应商乙' },
    ],
    exact: null,
  })

  const { results, meta } = await enrichTheftSuspectDriverVendor({
    results: [input],
    trackFacts: factsWithDriver('PARB'),
    imileToken: 'tok',
    queryDriverVendor: query,
  })

  assertVerdictUnchanged(results[0], input)
  assert.deepEqual(meta.ambiguousOrderNos, ['T1'])
  assert.deepEqual(meta.enrichedOrderNos, [])
  const vendorEntry = results[0].extraData?.entries.find((e) => e.label === '所属供应商')
  assert.equal(vendorEntry?.value, '按名字匹配到 2 条，未确认：供应商甲 / 供应商乙')
})

test('司机查询失败时仍保留派件员线索，错误进 meta，判定结论不变', async () => {
  const input = theftResult()
  const query: QueryDriverVendorFn = async () => ({
    ok: false,
    status: 502,
    message: '司机查询请求失败：请求超时',
  })

  const { results, meta } = await enrichTheftSuspectDriverVendor({
    results: [input],
    trackFacts: factsWithDriver('ADL-KAS-Parth'),
    imileToken: 'tok',
    queryDriverVendor: query,
  })

  assertVerdictUnchanged(results[0], input)
  assert.deepEqual(meta.errors, ['司机查询请求失败：请求超时'])
  assert.deepEqual(meta.enrichedOrderNos, [])
  assert.equal(results[0].extraData?.entries[0].value, 'ADL-KAS-Parth')
  const vendorEntry = results[0].extraData?.entries.find((e) => e.label === '所属供应商')
  assert.equal(vendorEntry?.value, '查询失败：司机查询请求失败：请求超时')
})

test('无 imileToken 时整体跳过，不发起任何查询', async () => {
  const input = theftResult()
  let called = 0
  const query: QueryDriverVendorFn = async () => {
    called += 1
    return { ok: true, matches: [], exact: null }
  }

  const { results, meta } = await enrichTheftSuspectDriverVendor({
    results: [input],
    trackFacts: factsWithDriver('ADL-KAS-Parth'),
    imileToken: '   ',
    queryDriverVendor: query,
  })

  assert.equal(called, 0)
  assert.equal(results[0], input)
  assert.equal(results[0].extraData, undefined)
  assert.deepEqual(meta.checkedOrderNos, [])
})

test('非「疑似派件员窃取」的行不写入额外数据', async () => {
  let called = 0
  const query: QueryDriverVendorFn = async () => {
    called += 1
    return { ok: true, matches: [], exact: null }
  }

  const rows = [
    theftResult({ exceptionCategoryId: '扫描员丢失' }),
    theftResult({ orderNo: 'T2', lossScope: '库外丢失', exceptionCategoryId: '疑似派件员窃取' }),
  ]
  const { results, meta } = await enrichTheftSuspectDriverVendor({
    results: rows,
    trackFacts: { ...factsWithDriver('ADL-KAS-Parth'), T2: factsWithDriver('X').T1 },
    imileToken: 'tok',
    queryDriverVendor: query,
  })

  assert.equal(called, 0)
  assert.equal(results[0].extraData, undefined)
  assert.equal(results[1].extraData, undefined)
  assert.deepEqual(meta.checkedOrderNos, [])
})

test('同一批内同一派件员只查询一次', async () => {
  let called = 0
  const query: QueryDriverVendorFn = async () => {
    called += 1
    return {
      ok: true,
      matches: [{ driverId: 'D1', driverName: 'SAME', vendorCode: 'V1', vendorName: '供应商甲' }],
      exact: { driverId: 'D1', driverName: 'SAME', vendorCode: 'V1', vendorName: '供应商甲' },
    }
  }

  const driver = factsWithDriver('SAME').T1
  const { results, meta } = await enrichTheftSuspectDriverVendor({
    results: [theftResult(), theftResult({ orderNo: 'T2' })],
    trackFacts: { T1: driver, T2: driver },
    imileToken: 'tok',
    queryDriverVendor: query,
  })

  assert.equal(called, 1)
  assert.deepEqual(meta.enrichedOrderNos, ['T1', 'T2'])
  assert.equal(results[0].extraData?.summary, results[1].extraData?.summary)
})

test('缺少 firstAssignCancelDriver 事实时不写入额外数据', async () => {
  let called = 0
  const query: QueryDriverVendorFn = async () => {
    called += 1
    return { ok: true, matches: [], exact: null }
  }

  const { results, meta } = await enrichTheftSuspectDriverVendor({
    results: [theftResult()],
    trackFacts: { T1: { firstAssignCancelDriver: null } as unknown as TrackFacts },
    imileToken: 'tok',
    queryDriverVendor: query,
  })

  assert.equal(called, 0)
  assert.equal(results[0].extraData, undefined)
  assert.deepEqual(meta.checkedOrderNos, [])
})
