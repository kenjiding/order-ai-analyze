import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateVendorDailyVolume, NO_ROUTE_CODE_LABEL } from './trendAggregate'
import type { ScopeConfig } from './supplierMatcher'

function config(input: {
  vendorCode: string
  vendorName?: string
  supplierNickname?: string
  routeCode?: string
}): ScopeConfig {
  return {
    vendorCode: input.vendorCode,
    vendorName: input.vendorName ?? input.vendorCode,
    supplierNickname: input.supplierNickname ?? null,
    routeCode: input.routeCode ?? '',
  } as ScopeConfig
}

function scan(input: { waybillNo: string; routeCode?: string; courierVendorCode?: string }) {
  return {
    waybillNo: input.waybillNo,
    routeCode: input.routeCode ?? '',
    courierVendorCode: input.courierVendorCode ?? '',
    consigneeZipCode: '5000',
  }
}

const LU = config({ vendorCode: 'SRM001', supplierNickname: 'ADL-Lu', routeCode: 'R1,R2' })
const CITY = config({ vendorCode: 'SRM001', supplierNickname: 'ADL-City', routeCode: 'R3' })

function supplierMetaOf(
  result: ReturnType<typeof aggregateVendorDailyVolume>,
  name: string,
) {
  const found = result.supplierMeta.find((s) => s.supplierName === name)
  assert.ok(found, `未找到供应商 ${name}`)
  return found
}

function countOf(
  result: ReturnType<typeof aggregateVendorDailyVolume>,
  supplierKey: string,
  date: string,
): number {
  return result.daily.find((p) => p.supplierKey === supplierKey && p.date === date)?.count ?? 0
}

test('同一运单当天被多次扫描只计 1 票', () => {
  const result = aggregateVendorDailyVolume({
    perDay: [
      {
        date: '2026-08-01',
        records: [
          scan({ waybillNo: 'W1', routeCode: 'R1' }),
          scan({ waybillNo: 'W1', routeCode: 'R1' }),
          scan({ waybillNo: 'W2', routeCode: 'R1' }),
        ],
      },
    ],
    configs: [LU],
    startDate: '2026-08-01',
    endDate: '2026-08-01',
  })

  assert.equal(result.meta.uniqueWaybills, 2)
  assert.equal(result.dayTotals['2026-08-01'], 2)
  const lu = supplierMetaOf(result, 'ADL-Lu')
  assert.equal(countOf(result, lu.supplierKey, '2026-08-01'), 2)
})

test('dayTotals 是当天去重后的真实票量，不是按供应商求和——一票匹配多个供应商单位时不会虚高', () => {
  // 构造一个会被同时判给两个 supplierKey 的场景：同一个 routeCode 出现在两条不同供应商的配置里
  const OVERLAP_A = config({ vendorCode: 'SRM010', supplierNickname: 'A', routeCode: 'R9' })
  const OVERLAP_B = config({ vendorCode: 'SRM011', supplierNickname: 'B', routeCode: 'R9' })
  const result = aggregateVendorDailyVolume({
    perDay: [{ date: '2026-08-01', records: [scan({ waybillNo: 'W1', routeCode: 'R9' })] }],
    configs: [OVERLAP_A, OVERLAP_B],
    startDate: '2026-08-01',
    endDate: '2026-08-01',
  })

  // dayTotals 必须是真实票量 1，不能因为这一票同时匹配了 A 和 B 就变成 2
  assert.equal(result.dayTotals['2026-08-01'], 1)
  assert.equal(result.meta.uniqueWaybills, 1)
})

test('拉取失败的天不进日期轴', () => {
  const result = aggregateVendorDailyVolume({
    perDay: [
      { date: '2026-08-01', records: [scan({ waybillNo: 'W1', routeCode: 'R1' })] },
      {
        date: '2026-08-03',
        records: [
          scan({ waybillNo: 'W2', routeCode: 'R1' }),
          scan({ waybillNo: 'W3', routeCode: 'R1' }),
        ],
      },
    ],
    configs: [LU],
    failedDates: ['2026-08-02'],
    startDate: '2026-08-01',
    endDate: '2026-08-03',
  })

  assert.deepEqual(result.dates, ['2026-08-01', '2026-08-03'])
  assert.deepEqual(result.meta.failedDates, ['2026-08-02'])
  assert.ok(!result.daily.some((point) => point.date === '2026-08-02'))
  assert.equal(result.dayTotals['2026-08-02'], undefined)
})

test('接口成功但当天票量为 0 的天：dayTotals 记为 0，daily 里仍有该日期的 0 计数行（脏数据判定交给前端）', () => {
  const result = aggregateVendorDailyVolume({
    perDay: [
      { date: '2026-08-01', records: [scan({ waybillNo: 'W1', routeCode: 'R1' })] },
      { date: '2026-08-02', records: [] },
    ],
    configs: [LU],
    startDate: '2026-08-01',
    endDate: '2026-08-02',
  })

  assert.deepEqual(result.dates, ['2026-08-01', '2026-08-02'])
  assert.equal(result.dayTotals['2026-08-02'], 0)
  const lu = supplierMetaOf(result, 'ADL-Lu')
  assert.equal(countOf(result, lu.supplierKey, '2026-08-02'), 0)
})

test('lastDayPartial 原样透传，不在这一阶段做任何裁剪判断', () => {
  const result = aggregateVendorDailyVolume({
    perDay: [{ date: '2026-08-01', records: [scan({ waybillNo: 'W1', routeCode: 'R1' })] }],
    configs: [LU],
    lastDayPartial: true,
    startDate: '2026-08-01',
    endDate: '2026-08-01',
  })
  assert.equal(result.meta.lastDayPartial, true)
})

test('区间内新增的供应商也照常记入 supplierMeta 和 daily（涨跌幅等统计交给前端算）', () => {
  const result = aggregateVendorDailyVolume({
    perDay: [
      { date: '2026-08-01', records: [scan({ waybillNo: 'W1', routeCode: 'R1' })] },
      { date: '2026-08-02', records: [scan({ waybillNo: 'W2', routeCode: 'R1' })] },
      {
        date: '2026-08-03',
        records: [
          scan({ waybillNo: 'W3', routeCode: 'R1' }),
          scan({ waybillNo: 'W4', routeCode: 'R3' }),
        ],
      },
      { date: '2026-08-04', records: [scan({ waybillNo: 'W5', routeCode: 'R3' })] },
    ],
    configs: [LU, CITY],
    startDate: '2026-08-01',
    endDate: '2026-08-04',
  })

  const city = supplierMetaOf(result, 'ADL-City')
  assert.equal(countOf(result, city.supplierKey, '2026-08-01'), 0)
  assert.equal(countOf(result, city.supplierKey, '2026-08-03'), 1)
  assert.equal(countOf(result, city.supplierKey, '2026-08-04'), 1)
})

test('路由码为空的扫描归入 (无路由码) 行且票数照常计入总量', () => {
  const result = aggregateVendorDailyVolume({
    perDay: [
      {
        date: '2026-08-01',
        records: [
          scan({ waybillNo: 'W1', routeCode: 'R1' }),
          // 没有路由码，但承运商能定位到 vendorCode
          scan({ waybillNo: 'W2', courierVendorCode: 'SRM002' }),
        ],
      },
    ],
    configs: [config({ vendorCode: 'SRM002', supplierNickname: 'NoRoute' }), LU],
    startDate: '2026-08-01',
    endDate: '2026-08-01',
  })

  const noRoute = supplierMetaOf(result, 'NoRoute')
  const rows = result.routeDaily.filter((row) => row.supplierKey === noRoute.supplierKey && row.count > 0)
  assert.deepEqual(
    rows.map((row) => row.routeCode),
    [NO_ROUTE_CODE_LABEL],
  )
})

test('同 vendorCode 不同展示名拆成两家，票量各归各家', () => {
  const result = aggregateVendorDailyVolume({
    perDay: [
      {
        date: '2026-08-01',
        records: [
          scan({ waybillNo: 'W1', routeCode: 'R1', courierVendorCode: 'SRM001' }),
          scan({ waybillNo: 'W2', routeCode: 'R2', courierVendorCode: 'SRM001' }),
          scan({ waybillNo: 'W3', routeCode: 'R3', courierVendorCode: 'SRM001' }),
        ],
      },
    ],
    configs: [LU, CITY],
    startDate: '2026-08-01',
    endDate: '2026-08-01',
  })

  assert.equal(result.supplierMeta.length, 2)
  const lu = supplierMetaOf(result, 'ADL-Lu')
  const city = supplierMetaOf(result, 'ADL-City')
  assert.equal(countOf(result, lu.supplierKey, '2026-08-01'), 2)
  assert.equal(countOf(result, city.supplierKey, '2026-08-01'), 1)
})

test('路由码对不上任何配置时落到未匹配供应商，并计入 unmatchedNoVendor', () => {
  const result = aggregateVendorDailyVolume({
    perDay: [
      {
        date: '2026-08-01',
        records: [
          scan({ waybillNo: 'W1', routeCode: 'R1' }),
          scan({ waybillNo: 'W2', routeCode: 'ZZZ' }),
        ],
      },
    ],
    configs: [LU],
    startDate: '2026-08-01',
    endDate: '2026-08-01',
  })

  assert.equal(result.meta.unmatchedNoVendor, 1)
  const unmatched = supplierMetaOf(result, '未匹配供应商')
  assert.equal(countOf(result, unmatched.supplierKey, '2026-08-01'), 1)
})
