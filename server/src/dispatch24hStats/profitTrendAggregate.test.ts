import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeProfitTrend,
  type DispatchProfitDailyRow,
} from '../../../shared/dispatchPerformance/profitTrendAggregate'

function row(over: Partial<DispatchProfitDailyRow> = {}): DispatchProfitDailyRow {
  return {
    arrivalDate: '2024-06-24',
    supplierKey: 'V1::ADL-Lu',
    supplierName: 'ADL-Lu',
    routeCode: 'R1',
    courierCode: 'C1',
    courierName: 'D1',
    vendorProfit: 0,
    courierProfit: 0,
    total: 0,
    pricedSignedCount: 0,
    unpricedSignedCount: 0,
    ...over,
  }
}

test('司机维度：出勤日每天赚的钱一样多 → 波动系数为 0，出勤率达标即判定为稳定候选', () => {
  const workedDays = ['2024-06-24', '2024-06-25', '2024-06-26', '2024-06-27'].map((date) =>
    row({ arrivalDate: date, courierProfit: 10, total: 1 }),
  )
  // 第 5 天站点有活动但这个司机没跑车（另一个司机顶班），出勤分母 = 5，该司机出勤 4/5 = 80%
  const otherDriverDay = row({ arrivalDate: '2024-06-28', courierCode: 'C2', courierName: 'D2', courierProfit: 5, total: 1 })
  const result = computeProfitTrend([...workedDays, otherDriverDay], 'day', 'courier')

  assert.equal(result.totalStationDays, 5)
  const driver = result.entities.find((d) => d.key === 'C1')!
  assert.equal(driver.attendanceDays, 4)
  assert.equal(driver.attendanceRate, 80)
  assert.equal(driver.cv, 0)
  assert.equal(driver.primaryProfit, 40)
  assert.equal(driver.totalCourierProfit, 40)
  assert.equal(driver.stable, true)
})

test('司机维度：跨供应商借调按 courierCode 全局合并，涉及供应商列出两家', () => {
  const rows = [
    row({ arrivalDate: '2024-06-24', supplierKey: 'A', supplierName: 'A厂', courierProfit: 10, total: 1 }),
    row({ arrivalDate: '2024-06-25', supplierKey: 'B', supplierName: 'B厂', courierProfit: 20, total: 1 }),
  ]
  const result = computeProfitTrend(rows, 'day', 'courier')
  assert.equal(result.entities.length, 1)
  const driver = result.entities[0]
  assert.equal(driver.primaryProfit, 30)
  assert.deepEqual(driver.supplierNames, ['A厂', 'B厂'])
})

test('司机维度：未派件（courierCode 为空）不进入汇总，但仍计入站点出勤天数分母', () => {
  const rows = [
    row({ arrivalDate: '2024-06-24', courierCode: '', courierName: '', courierProfit: 0, total: 5 }),
    row({ arrivalDate: '2024-06-25', courierProfit: 10, total: 1 }),
  ]
  const result = computeProfitTrend(rows, 'day', 'courier')
  assert.equal(result.totalStationDays, 2)
  assert.equal(result.entities.length, 1)
  assert.equal(result.entities[0].attendanceDays, 1)
})

test('周粒度：同一 ISO 周内多天的利润合并进同一个 bucket', () => {
  const rows = [
    row({ arrivalDate: '2024-06-24', courierProfit: 10, total: 1 }), // 周一
    row({ arrivalDate: '2024-06-25', courierProfit: 20, total: 1 }), // 周二，同一周
    row({ arrivalDate: '2024-07-01', courierProfit: 30, total: 1 }), // 下一周周一
  ]
  const result = computeProfitTrend(rows, 'week', 'courier')
  assert.equal(result.buckets.length, 2)
  const byBucket = result.entities[0].byBucket
  assert.equal(byBucket.find((b) => b.bucket === '2024-06-24')?.courierProfit, 30)
  assert.equal(byBucket.find((b) => b.bucket === '2024-07-01')?.courierProfit, 30)
})

test('出勤天数不足 2 天时波动系数给 null，不能显示成 0（那是「完美稳定」的假象）', () => {
  const rows = [row({ arrivalDate: '2024-06-24', courierProfit: 10, total: 1 })]
  const result = computeProfitTrend(rows, 'day', 'courier')
  assert.equal(result.entities[0].cv, null)
  assert.equal(result.entities[0].stable, false)
})

test('供应商维度：按 supplierKey 分组，看供应商利润（vendorProfit）而不是司机利润', () => {
  const rows = [
    row({ arrivalDate: '2024-06-24', supplierKey: 'A', supplierName: 'A厂', vendorProfit: 100, courierProfit: 10, total: 1 }),
    row({ arrivalDate: '2024-06-24', supplierKey: 'B', supplierName: 'B厂', vendorProfit: 50, courierProfit: 5, total: 1 }),
  ]
  const result = computeProfitTrend(rows, 'day', 'supplier')
  assert.equal(result.entities.length, 2)
  // 按供应商利润从高到低排序
  assert.deepEqual(result.entities.map((e) => e.key), ['A', 'B'])
  assert.equal(result.entities[0].primaryProfit, 100)
  assert.equal(result.entities[0].label, 'A厂')
})

test('路由码维度：同一路由跨司机合并，空路由码也是一个真实分组', () => {
  const rows = [
    row({ arrivalDate: '2024-06-24', routeCode: 'R1', courierCode: 'C1', vendorProfit: 30, total: 1 }),
    row({ arrivalDate: '2024-06-24', routeCode: 'R1', courierCode: 'C2', vendorProfit: 20, total: 1 }),
    row({ arrivalDate: '2024-06-24', routeCode: '', courierCode: 'C3', vendorProfit: 5, total: 1 }),
  ]
  const result = computeProfitTrend(rows, 'day', 'route')
  assert.equal(result.entities.length, 2)
  const r1 = result.entities.find((e) => e.key === 'R1')!
  assert.equal(r1.primaryProfit, 50)
  const empty = result.entities.find((e) => e.key === '')!
  assert.equal(empty.primaryProfit, 5)
})
