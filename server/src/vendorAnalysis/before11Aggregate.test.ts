import assert from 'node:assert/strict'
import test from 'node:test'
import { AUS_TZ } from '../imile/ausTimezone'
import { computeBefore11ThresholdMs } from '../imile/before11Exit'
import {
  aggregateBefore11ByScopes,
  filterBefore11RowsByScope,
  projectBefore11RatesByVendor,
  projectBefore11ZoneBreakdown,
  tagBefore11Rows,
  type Before11Scope,
} from './before11Aggregate'
import { buildScopeMapsFromConfig } from './supplierScope'

const thresholdMs = computeBefore11ThresholdMs('2026-07-08', AUS_TZ.Adelaide)

// 到件日 2026-07-08：次日 10:00 已出仓、14:00 / 无派件时间为未出仓
const rows: Array<Record<string, unknown>> = [
  { waybillNo: 'W1', courierVendorCode: 'V1', consigneeRouteCode: 'R1', deliveryTime: '2026-07-09 10:00:00', courierCode: 'C1', courier: '张三' },
  { waybillNo: 'W2', courierVendorCode: 'V1', consigneeRouteCode: 'R1', deliveryTime: '2026-07-09 14:00:00', courierCode: 'C1', courier: '张三' },
  { waybillNo: 'W3', courierVendorCode: 'V1', consigneeRouteCode: 'R2', deliveryTime: null, courierCode: 'C2', courier: '李四' },
  // 串线单：routeCode 在 V1 配置里，但承运方是 V9 —— 归属必须按 courierVendorCode
  { waybillNo: 'W4', courierVendorCode: 'V9', consigneeRouteCode: 'R1', deliveryTime: null, courierCode: 'C9', courier: '王五' },
  // 白名单路由：整行剔除
  { waybillNo: 'W5', courierVendorCode: 'V1', consigneeRouteCode: 'RW', deliveryTime: '2026-07-09 09:00:00', courierCode: 'C1', courier: '张三' },
]

const v1Config = { vendorCode: 'V1', routeCode: 'R1 R2', routeCodeWhitelist: 'RW' }
const taggedAll = tagBefore11Rows({ rows, before11ThresholdMs: thresholdMs })

test('tagBefore11Rows: 全量打标，不做范围过滤', () => {
  assert.deepEqual(taggedAll.map((r) => r.waybillNo), ['W1', 'W2', 'W3', 'W4', 'W5'])
  assert.deepEqual(taggedAll.map((r) => r.before11Exit), [true, false, false, false, true])
})

test('filterBefore11RowsByScope: 归属按 courierVendorCode，纳入收窄 + 白名单剔除', () => {
  const scoped = filterBefore11RowsByScope(taggedAll, buildScopeMapsFromConfig(v1Config), 'V1')
  assert.deepEqual(scoped.map((r) => r.waybillNo), ['W1', 'W2', 'W3'])
  assert.deepEqual(scoped.map((r) => r.before11Exit), [true, false, false])
})

test('不传 vendorCode 时保留全部供应商，各按自身范围过滤', () => {
  const scoped = filterBefore11RowsByScope(taggedAll, buildScopeMapsFromConfig(v1Config))
  // V9 无配置 → 不收窄整行保留；V1 的 RW 行被白名单剔除
  assert.deepEqual(scoped.map((r) => r.waybillNo), ['W1', 'W2', 'W3', 'W4'])
})

test('率投影与分区投影基于同一集合：total/unmet 恒等', () => {
  const scoped = filterBefore11RowsByScope(taggedAll, buildScopeMapsFromConfig(v1Config), 'V1')

  const rates = projectBefore11RatesByVendor(scoped, ['V1'])
  const zones = projectBefore11ZoneBreakdown(scoped)

  const zoneTotal = Object.values(zones).reduce((s, z) => s + z.total, 0)
  const zonePending = Object.values(zones).reduce((s, z) => s + z.pending, 0)

  assert.equal(rates.V1!.totalReceived, zoneTotal)
  assert.equal(rates.V1!.totalReceived - rates.V1!.before11ExitVolume, zonePending)
  assert.equal(rates.V1!.before11ExitRate, 1 / 3)
  assert.deepEqual(zones, {
    R1: { pending: 1, total: 2 },
    R2: { pending: 1, total: 1 },
  })
})

test('projectBefore11RatesByVendor: 只统计列出的供应商', () => {
  const scoped = filterBefore11RowsByScope(taggedAll, buildScopeMapsFromConfig(v1Config))
  const rates = projectBefore11RatesByVendor(scoped, ['V1'])
  assert.equal('V9' in rates, false)
})

test('filterBefore11RowsByScope: courierVendorCode 为空时按 consigneeRouteCode 反查兜底归属，计入 total 且按未达标处理', () => {
  const rowsWithPending: Array<Record<string, unknown>> = [
    ...rows,
    // 尚未派件：courierVendorCode 为空，routeCode 属于 V1 的纳入名单，靠反查兜底归属
    { waybillNo: 'W6', courierVendorCode: '', consigneeRouteCode: 'R1', deliveryTime: null, courierCode: '', courier: '' },
  ]
  const tagged = tagBefore11Rows({ rows: rowsWithPending, before11ThresholdMs: thresholdMs })
  const scoped = filterBefore11RowsByScope(tagged, buildScopeMapsFromConfig(v1Config), 'V1')

  assert.deepEqual(scoped.map((r) => r.waybillNo), ['W1', 'W2', 'W3', 'W6'])
  const w6 = scoped.find((r) => r.waybillNo === 'W6')
  assert.equal(w6?.courierVendorCode, 'V1') // 归属结果回填，供调用方按此分组
  assert.equal(w6?.before11Exit, false) // 未派件 = 未在 11 点前出仓，未达标
})

test('filterBefore11RowsByScope: routeCode 同时配置在多个供应商名下时（两家共担同一路由），courierVendorCode 为空的单各自独立命中，非互斥', () => {
  const sharedRows: Array<Record<string, unknown>> = [
    { waybillNo: 'X1', courierVendorCode: '', consigneeRouteCode: 'R1', deliveryTime: null, courierCode: '', courier: '' },
  ]
  const tagged = tagBefore11Rows({ rows: sharedRows, before11ThresholdMs: thresholdMs })
  // R1 同时属于 V1、V2 的纳入名单：两家共担同一路由
  const sharedScope = {
    routeCodesByVendor: new Map([
      ['V1', new Set(['R1'])],
      ['V2', new Set(['R1'])],
    ]),
    routeCodeWhitelistByVendor: new Map<string, Set<string>>(),
  }
  // 不传 targetVendor：两家都应各自独立命中，各自的统计里都要算上这单
  const scoped = filterBefore11RowsByScope(tagged, sharedScope)
  assert.deepEqual(
    scoped.map((r) => r.courierVendorCode).sort(),
    ['V1', 'V2'],
  )

  // 传 targetVendor='V1' 时（告警按单个供应商推送），只返回归给 V1 的那一条
  const scopedV1 = filterBefore11RowsByScope(tagged, sharedScope, 'V1')
  assert.equal(scopedV1.length, 1)
  assert.equal(scopedV1[0]?.courierVendorCode, 'V1')
})

test('aggregateBefore11ByScopes: 归属、纳入收窄、白名单剔除与 filterBefore11RowsByScope 逐个调用等价', () => {
  const scopes: Before11Scope[] = [{ key: 'cfg-v1', vendorCode: 'V1', routeCodes: new Set(['R1', 'R2']), routeCodeWhitelist: new Set(['RW']) }]
  const result = aggregateBefore11ByScopes({ rows: taggedAll, scopes })
  const stat = result.get('cfg-v1')

  const expectedScoped = filterBefore11RowsByScope(taggedAll, buildScopeMapsFromConfig(v1Config), 'V1')
  const expectedZones = projectBefore11ZoneBreakdown(expectedScoped)
  const expectedUnqualified = expectedScoped.filter((r) => !r.before11Exit).map((r) => r.waybillNo).filter(Boolean)

  assert.equal(stat?.totalWaybills, expectedScoped.length)
  assert.deepEqual(stat?.zoneBreakdown, expectedZones)
  assert.deepEqual(stat?.unqualifiedWaybillNos, expectedUnqualified)
})

test('aggregateBefore11ByScopes: 同 vendorCode 两条配置各自不同 routeCode 范围，一次遍历下各自独立统计', () => {
  const scopes: Before11Scope[] = [
    { key: 'cfg-region-1', vendorCode: 'V1', routeCodes: new Set(['R1']) },
    { key: 'cfg-region-2', vendorCode: 'V1', routeCodes: new Set(['R2']) },
  ]
  const result = aggregateBefore11ByScopes({ rows: taggedAll, scopes })
  // cfg-region-1 只收 R1：命中 W1、W2（V1/R1），V9 的 W4 不算，RW 的 W5 路由不在收窄范围内
  assert.equal(result.get('cfg-region-1')?.totalWaybills, 2)
  // cfg-region-2 只收 R2：命中 W3
  assert.equal(result.get('cfg-region-2')?.totalWaybills, 1)
})

test('aggregateBefore11ByScopes: 两个不同 vendorCode 共担同一路由码时，一次遍历下依然各自独立计入', () => {
  const sharedRows: Array<Record<string, unknown>> = [
    { waybillNo: 'X1', courierVendorCode: '', consigneeRouteCode: 'R1', deliveryTime: null, courierCode: '', courier: '' },
  ]
  const tagged = tagBefore11Rows({ rows: sharedRows, before11ThresholdMs: thresholdMs })
  const scopes: Before11Scope[] = [
    { key: 'cfg-v1', vendorCode: 'V1', routeCodes: new Set(['R1']) },
    { key: 'cfg-v2', vendorCode: 'V2', routeCodes: new Set(['R1']) },
  ]
  const result = aggregateBefore11ByScopes({ rows: tagged, scopes })
  assert.equal(result.get('cfg-v1')?.totalWaybills, 1)
  assert.equal(result.get('cfg-v2')?.totalWaybills, 1)
})
