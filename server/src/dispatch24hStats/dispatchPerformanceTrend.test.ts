import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDispatchPerformanceTrend,
  type DispatchPerformanceStatRow,
} from './repository'

function cell(over: Partial<DispatchPerformanceStatRow> = {}): DispatchPerformanceStatRow {
  return {
    arrivalDate: '2024-06-24',
    supplierKey: 'V1::ADL-Lu',
    supplierName: 'ADL-Lu',
    vendorCode: 'V1',
    routeCode: 'R1',
    courierCode: 'C1',
    courierName: 'D1',
    isWhitelist: false,
    dispatchSettled: true,
    total: 0,
    before11Met: 0,
    exitMetSignMet: 0,
    exitMetSignUnmet: 0,
    exitUnmetSignMet: 0,
    exitUnmetSignUnmet: 0,
    problemCount: 0,
    neverSignedCount: 0,
    lateSignedCount: 0,
    neverSignedWaybillNos: [],
    lateSignedWaybillNos: [],
    problemWaybillNos: [],
    before11UnmetWaybillNos: [],
    ...over,
  }
}

test('趋势聚合：供应商按天排除白名单，路由码保留白名单且未结算日派签率为 null', () => {
  const trend = buildDispatchPerformanceTrend([
    // day1: 非白名单路由
    cell({
      arrivalDate: '2024-06-24',
      routeCode: 'R1',
      total: 8,
      before11Met: 8,
      exitMetSignMet: 6,
      exitMetSignUnmet: 2,
    }),
    // day1: 白名单路由（不应影响供应商当天两个率）
    cell({
      arrivalDate: '2024-06-24',
      routeCode: 'R2',
      total: 2,
      isWhitelist: true,
      exitUnmetSignUnmet: 2,
      neverSignedCount: 2,
    }),
    // day2: 非白名单路由，派签尚未结算
    cell({
      arrivalDate: '2024-06-25',
      routeCode: 'R1',
      total: 5,
      before11Met: 3,
      dispatchSettled: false,
    }),
    // day2: 白名单路由
    cell({
      arrivalDate: '2024-06-25',
      routeCode: 'R2',
      total: 4,
      isWhitelist: true,
      dispatchSettled: false,
      before11Met: 1,
    }),
  ])

  assert.deepEqual(trend.dates, ['2024-06-24', '2024-06-25'])
  assert.equal(trend.suppliers.length, 1)
  assert.equal(trend.suppliers[0].supplierName, 'ADL-Lu')

  const supplierDailyByDate = new Map(trend.supplierDaily.map((point) => [point.date, point]))
  assert.equal(supplierDailyByDate.size, 2)
  assert.equal(supplierDailyByDate.get('2024-06-24')?.total, 8, '供应商维度应排除白名单')
  assert.equal(supplierDailyByDate.get('2024-06-24')?.before11Rate, 100)
  assert.equal(supplierDailyByDate.get('2024-06-24')?.signRate, 75)
  assert.equal(supplierDailyByDate.get('2024-06-25')?.total, 5, '供应商维度应排除白名单')
  assert.equal(supplierDailyByDate.get('2024-06-25')?.before11Rate, 60)
  assert.equal(supplierDailyByDate.get('2024-06-25')?.signRate, null, '未结算日派签率为 null')

  const routeDailyByDateCode = new Map(
    trend.routeDaily.map((point) => [`${point.date}|${point.routeCode}`, point]),
  )
  assert.equal(routeDailyByDateCode.get('2024-06-24|R2')?.total, 2, '路由码维度保留白名单单量')
  assert.equal(routeDailyByDateCode.get('2024-06-24|R2')?.isWhitelist, true)
  assert.equal(routeDailyByDateCode.get('2024-06-25|R2')?.total, 4)
  assert.equal(routeDailyByDateCode.get('2024-06-25|R2')?.isWhitelist, true)
  assert.equal(routeDailyByDateCode.get('2024-06-25|R1')?.signRate, null)
})
