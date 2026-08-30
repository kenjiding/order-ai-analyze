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

function supplierOf(result: ReturnType<typeof aggregateVendorDailyVolume>, name: string) {
  const found = result.suppliers.find((s) => s.supplierName === name)
  assert.ok(found, `未找到供应商 ${name}`)
  return found
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
  assert.equal(supplierOf(result, 'ADL-Lu').totalCount, 2)
})

test('拉取失败的天不进日期轴，也不被当成 0 票拉低日均', () => {
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
  // 3 票 / 2 个有效天 = 1.5，而不是 3 / 3 = 1
  assert.equal(supplierOf(result, 'ADL-Lu').dailyAvg, 1.5)
  assert.ok(!result.daily.some((point) => point.date === '2026-08-02'))
})

test('当天数据不完整时最后一天被排除出环比', () => {
  const perDay = [
    { date: '2026-08-01', records: [scan({ waybillNo: 'A1', routeCode: 'R1' })] },
    { date: '2026-08-02', records: [scan({ waybillNo: 'A2', routeCode: 'R1' })] },
    {
      date: '2026-08-03',
      records: [
        scan({ waybillNo: 'A3', routeCode: 'R1' }),
        scan({ waybillNo: 'A4', routeCode: 'R1' }),
      ],
    },
    // 当天只跑了半天，1 票；若混入环比会把这家算成在掉量
    { date: '2026-08-04', records: [scan({ waybillNo: 'A5', routeCode: 'R1' })] },
  ]

  const partial = aggregateVendorDailyVolume({
    perDay,
    configs: [LU],
    lastDayPartial: true,
    startDate: '2026-08-01',
    endDate: '2026-08-04',
  })
  assert.deepEqual(partial.meta.comparableDates, ['2026-08-01', '2026-08-02', '2026-08-03'])
  const partialLu = supplierOf(partial, 'ADL-Lu')
  // 前段 [08-01] = 1，后段 [08-02, 08-03] = (1+2)/2 = 1.5 → +50%
  assert.equal(partialLu.prevAvg, 1)
  assert.equal(partialLu.recentAvg, 1.5)
  assert.equal(partialLu.changeRate, 0.5)
  // 但整条日期轴与总量仍包含当天
  assert.equal(partial.dates.length, 4)
  assert.equal(partialLu.totalCount, 5)

  const complete = aggregateVendorDailyVolume({
    perDay,
    configs: [LU],
    lastDayPartial: false,
    startDate: '2026-08-01',
    endDate: '2026-08-04',
  })
  // 不排除时前段变成 (1+1)/2 = 1、后段 (2+1)/2 = 1.5，可比日期从 3 天变 4 天 —— 开关确实在起作用
  assert.equal(complete.meta.comparableDates.length, 4)
  assert.equal(supplierOf(complete, 'ADL-Lu').recentAvg, 1.5)
})

test('区间内新增的供应商 changeRate 为 null 而不是 Infinity', () => {
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

  const city = supplierOf(result, 'ADL-City')
  assert.equal(city.prevAvg, 0)
  assert.ok(city.recentAvg > 0)
  assert.equal(city.changeRate, null)
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

  const noRoute = supplierOf(result, 'NoRoute')
  assert.equal(noRoute.totalCount, 1)
  assert.equal(noRoute.routeCodeCount, 1)
  const rows = result.routeDaily.filter((row) => row.supplierKey === noRoute.supplierKey)
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

  assert.equal(result.suppliers.length, 2)
  assert.equal(supplierOf(result, 'ADL-Lu').totalCount, 2)
  assert.equal(supplierOf(result, 'ADL-City').totalCount, 1)
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
  assert.equal(supplierOf(result, '未匹配供应商').totalCount, 1)
})
