import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildScopeMapsFromConfig,
  buildScopeRecordsFromConfigs,
  isRowInVendorScope,
  type VendorScopeMaps,
} from './supplierScope'

function scope(input: {
  routeCodes?: Record<string, string[]>
  whitelist?: Record<string, string[]>
}): VendorScopeMaps {
  const toMap = (rec: Record<string, string[]> = {}) =>
    new Map(Object.entries(rec).map(([k, v]) => [k, new Set(v)]))
  return {
    routeCodesByVendor: toMap(input.routeCodes),
    routeCodeWhitelistByVendor: toMap(input.whitelist),
  }
}

test('isRowInVendorScope: 未配置供应商不收窄、无白名单', () => {
  assert.equal(isRowInVendorScope('V1', 'R1', scope({})), true)
  assert.equal(isRowInVendorScope('V1', '', scope({})), true)
})

test('isRowInVendorScope: routeCode 纳入名单收窄', () => {
  const s = scope({ routeCodes: { V1: ['R1', 'R2'] } })
  assert.equal(isRowInVendorScope('V1', 'R1', s), true)
  assert.equal(isRowInVendorScope('V1', ' R2 ', s), true)
  assert.equal(isRowInVendorScope('V1', 'R9', s), false)
  // 其他供应商不受 V1 的纳入名单影响
  assert.equal(isRowInVendorScope('V2', 'R9', s), true)
})

test('isRowInVendorScope: 白名单命中整行剔除，且优先级高于纳入命中', () => {
  const s = scope({ routeCodes: { V1: ['R1'] }, whitelist: { V1: ['R1'] } })
  assert.equal(isRowInVendorScope('V1', 'R1', s), false)
})

test('buildScopeMapsFromConfig: 单配置独立范围；空 routeCode 不建纳入条目（= 不收窄）', () => {
  const s = buildScopeMapsFromConfig({ vendorCode: 'V1', routeCode: 'R1, R2', routeCodeWhitelist: 'R9' })
  assert.equal(isRowInVendorScope('V1', 'R1', s), true)
  assert.equal(isRowInVendorScope('V1', 'R3', s), false)
  assert.equal(isRowInVendorScope('V1', 'R9', s), false)

  const empty = buildScopeMapsFromConfig({ vendorCode: 'V1', routeCode: '', routeCodeWhitelist: '' })
  assert.equal(isRowInVendorScope('V1', '任意', empty), true)
})

test('buildScopeRecordsFromConfigs: 同 vendorCode 多配置取并集，空列表不建条目', () => {
  const records = buildScopeRecordsFromConfigs([
    { vendorCode: 'V1', routeCode: 'R1 R2', routeCodeWhitelist: '' },
    { vendorCode: 'V1', routeCode: 'R2，R3', routeCodeWhitelist: 'W1' },
    { vendorCode: ' V2 ', routeCode: '', routeCodeWhitelist: '' },
  ])
  assert.deepEqual([...records.routeCodesByVendor.V1!].sort(), ['R1', 'R2', 'R3'])
  assert.deepEqual(records.routeCodeWhitelistByVendor.V1, ['W1'])
  assert.equal('V2' in records.routeCodesByVendor, false)
})
