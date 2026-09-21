import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeTrendView,
  mondayOfWeek,
  type VendorVolumeTrendRawResult,
} from '../../../shared/vendorRegionMap/trendPeriodAggregate'

function raw(input: {
  dates: string[]
  dayTotals: Record<string, number>
  daily: { date: string; supplierKey: string; count: number }[]
  routeDaily?: { date: string; supplierKey: string; routeCode: string; count: number }[]
  supplierMeta: { supplierKey: string; supplierName: string; vendorCode?: string }[]
  lastDayPartial?: boolean
  failedDates?: string[]
}): VendorVolumeTrendRawResult {
  return {
    dates: input.dates,
    dayTotals: input.dayTotals,
    daily: input.daily,
    routeDaily: input.routeDaily ?? [],
    supplierMeta: input.supplierMeta.map((m) => ({ vendorCode: '', ...m })),
    meta: {
      startDate: input.dates[0] ?? '',
      endDate: input.dates[input.dates.length - 1] ?? '',
      uniqueWaybills: Object.values(input.dayTotals).reduce((a, b) => a + b, 0),
      unmatchedNoVendor: 0,
      failedDates: input.failedDates ?? [],
      lastDayPartial: input.lastDayPartial === true,
    },
  }
}

function supplierOf(view: ReturnType<typeof computeTrendView>, supplierKey: string) {
  const found = view.suppliers.find((s) => s.supplierKey === supplierKey)
  assert.ok(found, `未找到供应商 ${supplierKey}`)
  return found
}

test('mondayOfWeek：周六/周日归到上一个周一，周一到周日同一个 key', () => {
  assert.equal(mondayOfWeek('2026-08-01'), '2026-07-27') // 周六
  assert.equal(mondayOfWeek('2026-08-02'), '2026-07-27') // 周日
  assert.equal(mondayOfWeek('2026-08-03'), '2026-08-03') // 周一
  assert.equal(mondayOfWeek('2026-08-08'), '2026-08-03') // 周六，同一周
})

test('day 视图：阈值为 0 时原样透传，dailyAvg/峰谷/环比按整条日期轴计算', () => {
  const input = raw({
    dates: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'],
    dayTotals: { '2026-08-01': 1, '2026-08-02': 2, '2026-08-03': 3, '2026-08-04': 4 },
    daily: [
      { date: '2026-08-01', supplierKey: 'A', count: 1 },
      { date: '2026-08-02', supplierKey: 'A', count: 2 },
      { date: '2026-08-03', supplierKey: 'A', count: 3 },
      { date: '2026-08-04', supplierKey: 'A', count: 4 },
    ],
    supplierMeta: [{ supplierKey: 'A', supplierName: 'Alpha' }],
  })

  const view = computeTrendView({ raw: input, dirtyThreshold: 0, granularity: 'day' })
  assert.deepEqual(view.dates, input.dates)
  const a = supplierOf(view, 'A')
  assert.equal(a.totalCount, 10)
  assert.equal(a.dailyAvg, 2.5)
  assert.equal(a.peakCount, 4)
  assert.equal(a.peakDate, '2026-08-04')
  assert.equal(a.lowCount, 1)
  assert.equal(a.lowDate, '2026-08-01')
  // 对半切：前段 [1,2] 均 1.5，后段 [3,4] 均 3.5 → +133.3%
  assert.equal(a.prevAvg, 1.5)
  assert.equal(a.recentAvg, 3.5)
})

test('脏数据阈值：当天票量低于阈值整天剔除，不拉低 dailyAvg', () => {
  const input = raw({
    dates: ['2026-08-01', '2026-08-02', '2026-08-03'],
    dayTotals: { '2026-08-01': 1, '2026-08-02': 0, '2026-08-03': 3 },
    daily: [
      { date: '2026-08-01', supplierKey: 'A', count: 1 },
      { date: '2026-08-02', supplierKey: 'A', count: 0 },
      { date: '2026-08-03', supplierKey: 'A', count: 3 },
    ],
    supplierMeta: [{ supplierKey: 'A', supplierName: 'Alpha' }],
  })

  const lax = computeTrendView({ raw: input, dirtyThreshold: 1, granularity: 'day' })
  assert.deepEqual(lax.dates, ['2026-08-01', '2026-08-03'])
  assert.deepEqual(lax.meta.dirtyDates, ['2026-08-02'])
  // 4 票 / 2 个有效天 = 2，而不是 4 / 3
  assert.equal(supplierOf(lax, 'A').dailyAvg, 2)

  // 阈值提到 2：08-01（1 票）也判定为脏数据
  const strict = computeTrendView({ raw: input, dirtyThreshold: 2, granularity: 'day' })
  assert.deepEqual(strict.dates, ['2026-08-03'])
  assert.deepEqual(strict.meta.dirtyDates, ['2026-08-01', '2026-08-02'])
  assert.equal(supplierOf(strict, 'A').totalCount, 3)
})

test('今天恰好是脏数据时，环比不会把旁边另一天也当成不完整吞掉', () => {
  const input = raw({
    dates: ['2026-08-01', '2026-08-02', '2026-08-03'],
    dayTotals: { '2026-08-01': 1, '2026-08-02': 1, '2026-08-03': 0 },
    daily: [
      { date: '2026-08-01', supplierKey: 'A', count: 1 },
      { date: '2026-08-02', supplierKey: 'A', count: 1 },
      { date: '2026-08-03', supplierKey: 'A', count: 0 },
    ],
    supplierMeta: [{ supplierKey: 'A', supplierName: 'Alpha' }],
    lastDayPartial: true,
  })

  const view = computeTrendView({ raw: input, dirtyThreshold: 1, granularity: 'day' })
  assert.deepEqual(view.dates, ['2026-08-01', '2026-08-02'])
  // 08-03 已经因为脏数据被剔除，08-02 不该再被当成「不完整的今天」吞掉
  assert.equal(view.meta.lastDayPartial, false)
  assert.deepEqual(view.meta.comparableDates, ['2026-08-01', '2026-08-02'])
})

test('当天数据不完整时最后一天被排除出环比（真正不完整、没有脏数据介入的情形）', () => {
  const input = raw({
    dates: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'],
    dayTotals: { '2026-08-01': 1, '2026-08-02': 1, '2026-08-03': 2, '2026-08-04': 1 },
    daily: [
      { date: '2026-08-01', supplierKey: 'A', count: 1 },
      { date: '2026-08-02', supplierKey: 'A', count: 1 },
      { date: '2026-08-03', supplierKey: 'A', count: 2 },
      { date: '2026-08-04', supplierKey: 'A', count: 1 },
    ],
    supplierMeta: [{ supplierKey: 'A', supplierName: 'Alpha' }],
    lastDayPartial: true,
  })

  const partial = computeTrendView({ raw: input, dirtyThreshold: 0, granularity: 'day' })
  assert.deepEqual(partial.meta.comparableDates, ['2026-08-01', '2026-08-02', '2026-08-03'])
  const a = supplierOf(partial, 'A')
  assert.equal(a.prevAvg, 1)
  assert.equal(a.recentAvg, 1.5)
  assert.equal(a.changeRate, 0.5)
  // 但整条日期轴与总量仍包含当天
  assert.equal(partial.dates.length, 4)
  assert.equal(a.totalCount, 5)
})

test('区间内新增的供应商 changeRate 为 null 而不是 Infinity', () => {
  const input = raw({
    dates: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'],
    dayTotals: { '2026-08-01': 1, '2026-08-02': 1, '2026-08-03': 2, '2026-08-04': 1 },
    daily: [
      { date: '2026-08-01', supplierKey: 'A', count: 1 },
      { date: '2026-08-02', supplierKey: 'A', count: 1 },
      { date: '2026-08-03', supplierKey: 'A', count: 1 },
      { date: '2026-08-04', supplierKey: 'A', count: 0 },
      { date: '2026-08-03', supplierKey: 'B', count: 1 },
      { date: '2026-08-04', supplierKey: 'B', count: 1 },
    ],
    supplierMeta: [
      { supplierKey: 'A', supplierName: 'Alpha' },
      { supplierKey: 'B', supplierName: 'Beta' },
    ],
  })

  const view = computeTrendView({ raw: input, dirtyThreshold: 0, granularity: 'day' })
  const b = supplierOf(view, 'B')
  assert.equal(b.prevAvg, 0)
  assert.ok(b.recentAvg > 0)
  assert.equal(b.changeRate, null)
})

test('week 视图：先按天剔除脏数据，再合桶——阈值语义不会变成周阈值', () => {
  const input = raw({
    // 2026-08-03 是周一：08-01/08-02 属于上一周，08-03~08-04 属于本周
    dates: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'],
    dayTotals: { '2026-08-01': 1, '2026-08-02': 0, '2026-08-03': 2, '2026-08-04': 3 },
    daily: [
      { date: '2026-08-01', supplierKey: 'A', count: 1 },
      { date: '2026-08-02', supplierKey: 'A', count: 0 },
      { date: '2026-08-03', supplierKey: 'A', count: 2 },
      { date: '2026-08-04', supplierKey: 'A', count: 3 },
    ],
    supplierMeta: [{ supplierKey: 'A', supplierName: 'Alpha' }],
  })

  const view = computeTrendView({ raw: input, dirtyThreshold: 1, granularity: 'week' })
  assert.deepEqual(view.meta.dirtyDates, ['2026-08-02'])
  // 上一周只剩 08-01（1 票），本周是 08-03+08-04 合桶（5 票）
  assert.deepEqual(view.dates, ['2026-07-27', '2026-08-03'])
  const a = supplierOf(view, 'A')
  assert.equal(a.totalCount, 6)
  assert.equal(a.peakCount, 5)
  assert.equal(a.peakDate, '2026-08-03')
})

test('week 视图：今天所在的周未完整时，环比要把最后一个周桶排除', () => {
  const input = raw({
    // 08-03(周一)~08-09(周日) 是同一周；假设今天是 08-05，只跑到这里
    dates: ['2026-08-03', '2026-08-04', '2026-08-05'],
    dayTotals: { '2026-08-03': 2, '2026-08-04': 2, '2026-08-05': 1 },
    daily: [
      { date: '2026-08-03', supplierKey: 'A', count: 2 },
      { date: '2026-08-04', supplierKey: 'A', count: 2 },
      { date: '2026-08-05', supplierKey: 'A', count: 1 },
    ],
    supplierMeta: [{ supplierKey: 'A', supplierName: 'Alpha' }],
    lastDayPartial: true,
  })

  const view = computeTrendView({ raw: input, dirtyThreshold: 0, granularity: 'week' })
  // 三天全部合进同一个周桶，这个桶本身就是「今天所在、还没跑完」的桶
  assert.deepEqual(view.dates, ['2026-08-03'])
  assert.equal(view.meta.lastDayPartial, true)
  assert.deepEqual(view.meta.comparableDates, [])
})

test('routeDaily 会跟着脏数据剔除和合桶一起走，routeCodeCount 按剩下的日期算', () => {
  const input = raw({
    dates: ['2026-08-01', '2026-08-02', '2026-08-03'],
    dayTotals: { '2026-08-01': 1, '2026-08-02': 0, '2026-08-03': 1 },
    daily: [
      { date: '2026-08-01', supplierKey: 'A', count: 1 },
      { date: '2026-08-02', supplierKey: 'A', count: 0 },
      { date: '2026-08-03', supplierKey: 'A', count: 1 },
    ],
    routeDaily: [
      { date: '2026-08-01', supplierKey: 'A', routeCode: 'R1', count: 1 },
      // 这条路由码只在被判脏数据的那天出现过，剔除后不该再计入 routeCodeCount
      { date: '2026-08-02', supplierKey: 'A', routeCode: 'R2', count: 0 },
      { date: '2026-08-03', supplierKey: 'A', routeCode: 'R1', count: 1 },
    ],
    supplierMeta: [{ supplierKey: 'A', supplierName: 'Alpha' }],
  })

  const view = computeTrendView({ raw: input, dirtyThreshold: 1, granularity: 'day' })
  const a = supplierOf(view, 'A')
  assert.equal(a.routeCodeCount, 1)
  assert.ok(!view.routeDaily.some((row) => row.date === '2026-08-02'))
})

test('server 吐的是稠密网格（每个曾出现过的 supplierKey/routeCode 在每个原始日期都有一行，多数是 0）——' +
  '0 计数的行不能让 routeCodeCount/供应商列表凭空多出从没真正发生过的项', () => {
  const input = raw({
    dates: ['2026-08-01', '2026-08-02'],
    dayTotals: { '2026-08-01': 1, '2026-08-02': 1 },
    daily: [
      { date: '2026-08-01', supplierKey: 'A', count: 1 },
      { date: '2026-08-02', supplierKey: 'A', count: 1 },
      // B 在这两天都是 0 票（真实业务里它可能只在别的、已被判脏数据剔除的日期出现过）
      { date: '2026-08-01', supplierKey: 'B', count: 0 },
      { date: '2026-08-02', supplierKey: 'B', count: 0 },
    ],
    routeDaily: [
      { date: '2026-08-01', supplierKey: 'A', routeCode: 'R1', count: 1 },
      { date: '2026-08-02', supplierKey: 'A', routeCode: 'R1', count: 1 },
      // R2 在这两天都是 0 票，同样不该被算进 routeCodeCount
      { date: '2026-08-01', supplierKey: 'A', routeCode: 'R2', count: 0 },
      { date: '2026-08-02', supplierKey: 'A', routeCode: 'R2', count: 0 },
    ],
    supplierMeta: [
      { supplierKey: 'A', supplierName: 'Alpha' },
      { supplierKey: 'B', supplierName: 'Beta' },
    ],
  })

  const view = computeTrendView({ raw: input, dirtyThreshold: 0, granularity: 'day' })
  assert.ok(!view.suppliers.some((s) => s.supplierKey === 'B'), 'B 全程 0 票，不该出现在供应商列表里')
  assert.equal(supplierOf(view, 'A').routeCodeCount, 1)
})
