import assert from 'node:assert/strict'
import test from 'node:test'
import { AUS_TZ } from '../imile/ausTimezone'
import { computeBefore11ThresholdMs } from '../imile/before11Exit'
import {
  projectBefore11RatesByVendor,
  projectBefore11ZoneBreakdown,
  tagBefore11Rows,
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

test('tagBefore11Rows: 归属按 courierVendorCode，纳入收窄 + 白名单剔除', () => {
  const tagged = tagBefore11Rows({
    rows,
    before11ThresholdMs: thresholdMs,
    scope: buildScopeMapsFromConfig(v1Config),
    vendorCode: 'V1',
  })
  assert.deepEqual(tagged.map((r) => r.waybillNo), ['W1', 'W2', 'W3'])
  assert.deepEqual(tagged.map((r) => r.before11Exit), [true, false, false])
})

test('不传 vendorCode 时保留全部供应商，各按自身范围过滤', () => {
  const tagged = tagBefore11Rows({
    rows,
    before11ThresholdMs: thresholdMs,
    scope: buildScopeMapsFromConfig(v1Config),
  })
  // V9 无配置 → 不收窄整行保留；V1 的 RW 行被白名单剔除
  assert.deepEqual(tagged.map((r) => r.waybillNo), ['W1', 'W2', 'W3', 'W4'])
})

test('率投影与分区投影基于同一集合：total/unmet 恒等', () => {
  const tagged = tagBefore11Rows({
    rows,
    before11ThresholdMs: thresholdMs,
    scope: buildScopeMapsFromConfig(v1Config),
    vendorCode: 'V1',
  })

  const rates = projectBefore11RatesByVendor(tagged, ['V1'])
  const zones = projectBefore11ZoneBreakdown(tagged)

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
  const tagged = tagBefore11Rows({ rows, before11ThresholdMs: thresholdMs, scope: buildScopeMapsFromConfig(v1Config) })
  const rates = projectBefore11RatesByVendor(tagged, ['V1'])
  assert.equal('V9' in rates, false)
})
