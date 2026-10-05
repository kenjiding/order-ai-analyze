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
import { buildConfigScope, buildScopeMapsFromConfig } from './supplierScope'

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
    R1: { pending: 1, total: 2, priority: 0, priorityExited: 0 },
    R2: { pending: 1, total: 1, priority: 0, priorityExited: 0 },
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
  // cfg-region-1 收 R1：命中 W1、W2（V1/R1）；V9 的 W4 不算（承运商不对，不兜底到别家头上）；
  // W5（V1/RW）两条子配置都没配 RW——vendorCode 精确匹配但路由被两边都收窄掉，按兜底落到
  // 第一条子配置（cfg-region-1），不再像以前那样两条子配置都不要、数据凭空消失
  assert.equal(result.get('cfg-region-1')?.totalWaybills, 3)
  // cfg-region-2 只收 R2：命中 W3，不受兜底影响（兜底只会落到 vendorCode 匹配的第一条）
  assert.equal(result.get('cfg-region-2')?.totalWaybills, 1)
})

test('aggregateBefore11ByScopes: 只有一条子配置时，路由超出它收窄的范围仍兜底落到它自己身上，不会凭空消失', () => {
  const scopes: Before11Scope[] = [{ key: 'cfg-region-1', vendorCode: 'V1', routeCodes: new Set(['R1']) }]
  const result = aggregateBefore11ByScopes({ rows: taggedAll, scopes })
  // routeCodes 收窄的作用只是「同一 vendorCode 下多个子配置时分给谁」，不是「该不该算这个供应商」——
  // 只有这一条配置时，W3（V1/R2）、W5（V1/RW）一样兜底落回它，不会因为路由不在收窄名单里就消失
  assert.equal(result.get('cfg-region-1')?.totalWaybills, 4, 'W1、W2、W3、W5 都算，只有 W4（V9）被排除')
})

test('aggregateBefore11ByScopes: vendorCode 在任何 scope 里都查不到——真正的配置缺失，不兜底，数据不计入任何供应商', () => {
  const unknownVendorRows: Array<Record<string, unknown>> = [
    { waybillNo: 'U1', courierVendorCode: 'V9', consigneeRouteCode: 'R9', deliveryTime: null, courierCode: 'C9', courier: '' },
  ]
  const tagged = tagBefore11Rows({ rows: unknownVendorRows, before11ThresholdMs: thresholdMs })
  const scopes: Before11Scope[] = [{ key: 'cfg-region-1', vendorCode: 'V1', routeCodes: new Set(['R1']) }]
  const result = aggregateBefore11ByScopes({ rows: tagged, scopes })
  assert.equal(result.size, 0, 'V9 不是任何已配置供应商，不兜底、不计入')
})

test('aggregateBefore11ByScopes: 兜底命中的子配置若把这条路由配进了自己的白名单，仍按白名单分桶，不计入主统计', () => {
  const scopes: Before11Scope[] = [
    { key: 'cfg-region-1', vendorCode: 'V1', routeCodes: new Set(['R1']), routeCodeWhitelist: new Set(['RW']) },
    { key: 'cfg-region-2', vendorCode: 'V1', routeCodes: new Set(['R2']) },
  ]
  const result = aggregateBefore11ByScopes({ rows: taggedAll, scopes })
  const stat = result.get('cfg-region-1')
  // W5（V1/RW）兜底落到 cfg-region-1（第一条 vendorCode 匹配的子配置），但它自己把 RW 配进了白名单，
  // 所以不计入主统计 totalWaybills，而是按既有口径单列进 whitelistStat——兜底不能绕开白名单规则
  assert.equal(stat?.totalWaybills, 2, '主统计仍只有 W1、W2')
  assert.equal(stat?.whitelistStat?.totalWaybills, 1, 'W5 单列进白名单分桶')
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

test('未选供应商的配置：整站按路由码归集，串线单也算进来，白名单仍单列', () => {
  // W1/W2 在 R1（V1 承运），W4 也在 R1 但承运方是 V9 —— 纯路由码口径下都算这条配置的
  const scope = buildConfigScope('cfg-route-only', {
    vendorCode: '',
    routeCode: 'R1, RW',
    routeCodeWhitelist: 'RW',
  })
  const stat = aggregateBefore11ByScopes({ rows: taggedAll, scopes: [scope] }).get('cfg-route-only')
  assert.ok(stat)
  assert.equal(stat.totalWaybills, 3) // W1 已出仓 + W2 未出仓 + W4（V9 串线）未出仓
  assert.deepEqual(stat.zoneBreakdown, { R1: { pending: 2, total: 3, priority: 0, priorityExited: 0 } })
  assert.deepEqual(stat.unqualifiedWaybillNos.sort(), ['W2', 'W4'])
  // 白名单路由 RW 不进主统计，单独计入 whitelistStat
  assert.equal(stat.whitelistStat?.totalWaybills, 1)
  // R2 不在纳入名单 → 一件都不算
  assert.deepEqual(Object.keys(stat.zoneBreakdown), ['R1'])
})

test('aggregateBefore11ByScopes: clientCode 命中「优先客户配置」时按分区统计优先件数（大小写不敏感）', () => {
  const priorityRows: Array<Record<string, unknown>> = [
    { waybillNo: 'W1', courierVendorCode: 'V1', consigneeRouteCode: 'R1', clientCode: 'vip001', deliveryTime: '2026-07-09 14:00:00' },
    { waybillNo: 'W2', courierVendorCode: 'V1', consigneeRouteCode: 'R1', clientCode: 'VIP001', deliveryTime: '2026-07-09 10:00:00' },
    { waybillNo: 'W3', courierVendorCode: 'V1', consigneeRouteCode: 'R1', clientCode: 'OTHER', deliveryTime: '2026-07-09 14:00:00' },
  ]
  const tagged = tagBefore11Rows({ rows: priorityRows, before11ThresholdMs: thresholdMs })
  const scopes: Before11Scope[] = [{ key: 'cfg', vendorCode: 'V1', routeCodes: new Set(['R1']) }]
  const stat = aggregateBefore11ByScopes({ rows: tagged, scopes, priorityClientCodes: new Set(['VIP001']) }).get('cfg')

  // 优先件按分区总量统计（不限于未出仓那部分）：W1 + W2 = 2
  // W2 已出仓（10:00）、W1 未出仓（14:00）：优先件 2 件，其中已出仓 1 件
  assert.deepEqual(stat?.zoneBreakdown, { R1: { pending: 2, total: 3, priority: 2, priorityExited: 1 } })
  // 不传名单时不统计优先件
  assert.equal(aggregateBefore11ByScopes({ rows: tagged, scopes }).get('cfg')?.zoneBreakdown.R1?.priority, 0)
})
