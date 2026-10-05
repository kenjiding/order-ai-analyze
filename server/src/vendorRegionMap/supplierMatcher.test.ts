import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSupplierMatcher, type ScopeConfig } from './supplierMatcher'

function cfg(input: Partial<ScopeConfig> & { vendorCode: string }): ScopeConfig {
  return {
    vendorCode: input.vendorCode,
    vendorName: input.vendorName ?? input.vendorCode,
    supplierNickname: input.supplierNickname ?? '',
    routeCode: input.routeCode ?? '',
  }
}

test('buildSupplierMatcher: 正常归属——courierVendorCode 匹配且路由在纳入名单里', () => {
  const matcher = buildSupplierMatcher([cfg({ vendorCode: 'V1', supplierNickname: 'A', routeCode: 'R1' })])
  assert.deepEqual(matcher.resolveUnitKeys({ courierVendorCode: 'V1', routeCode: 'R1' }), ['V1::A'])
})

test('buildSupplierMatcher: 同 vendorCode 两个单位（ADL-City/ADL-Lu），courierVendorCode 精确匹配但路由不在任一单位名单里——兜底落到第一个单位', () => {
  const matcher = buildSupplierMatcher([
    cfg({ vendorCode: 'V1', supplierNickname: 'ADL-City', routeCode: 'R-CITY' }),
    cfg({ vendorCode: 'V1', supplierNickname: 'ADL-Lu', routeCode: 'R-LU' }),
  ])
  const keys = matcher.resolveUnitKeys({ courierVendorCode: 'V1', routeCode: 'BB009' })
  assert.equal(keys.length, 1, '只落一个单位，不能两个单位都算一遍导致重复计数')
  assert.deepEqual(keys, ['V1::ADL-City'])
})

test('buildSupplierMatcher: courierVendorCode 是已知但未配置的供应商——不会因为路由码碰巧对上就错配给别家', () => {
  // 迁移前的旧实现：courier 查不到候选时会直接退回纯路由码匹配（不管 courier 是「空」还是「有值但未配置」），
  // 导致 V9 的单因为路由码 R1 恰好配在 V1 名下而被错误地算成 V1 的。改用共享判定后，vendorCode 一旦非空
  // 且不等于任何 scope 的 vendorCode 就直接判负——只有 vendorCode 本身为空（未派件）才会退回路由码兜底，
  // 不会把别家已知的运单错算给路由码凑巧对上的供应商。
  const matcher = buildSupplierMatcher([cfg({ vendorCode: 'V1', supplierNickname: 'A', routeCode: 'R1' })])
  assert.deepEqual(matcher.resolveUnitKeys({ courierVendorCode: 'V9', routeCode: 'R1' }), [])
})

test('buildSupplierMatcher: courierVendorCode 为空（未派件）时按路由码兜底归属，可能同时命中多家共担同一路由的单位', () => {
  const matcher = buildSupplierMatcher([
    cfg({ vendorCode: 'V1', supplierNickname: 'A', routeCode: 'R1' }),
    cfg({ vendorCode: 'V2', supplierNickname: 'B', routeCode: 'R1' }),
  ])
  const keys = matcher.resolveUnitKeys({ courierVendorCode: '', routeCode: 'R1' }).sort()
  assert.deepEqual(keys, ['V1::A', 'V2::B'])
})

test('buildSupplierMatcher: 单位未配路由码（不收窄）时，courierVendorCode 匹配即算，不受路由限制', () => {
  const matcher = buildSupplierMatcher([cfg({ vendorCode: 'V1', supplierNickname: 'A', routeCode: '' })])
  assert.deepEqual(matcher.resolveUnitKeys({ courierVendorCode: 'V1', routeCode: '随便什么路由' }), ['V1::A'])
})
