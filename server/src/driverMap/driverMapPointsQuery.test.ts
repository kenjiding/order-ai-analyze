import assert from 'node:assert/strict'
import test from 'node:test'
import { buildScopeFilter } from './driverMapPointsQuery'

test('buildScopeFilter: 未限定供应商与路由码时，什么都接受', () => {
  const filter = buildScopeFilter(undefined)
  assert.equal(filter.accept({ vendorCode: 'V1', consigneeRouteCode: 'R1' }), true)
  assert.equal(filter.accept({ vendorCode: '', consigneeRouteCode: '' }), true)
})

test('buildScopeFilter: 正常归属——vendorCode 匹配且路由在纳入名单里', () => {
  const filter = buildScopeFilter({ vendorCode: 'V1', routeCodes: ['R1'] })
  assert.equal(filter.accept({ vendorCode: 'V1', consigneeRouteCode: 'R1' }), true)
  assert.equal(filter.accept({ vendorCode: 'V2', consigneeRouteCode: 'R1' }), false)
})

test('buildScopeFilter: vendorCode 精确匹配但路由不在纳入名单里——兜底接受，不再被整单过滤掉', () => {
  // 对应司机地图的借调场景：承运商确实是 V1，但这条路由没配进 V1 的纳入名单
  const filter = buildScopeFilter({ vendorCode: 'V1', routeCodes: ['R1'] })
  assert.equal(filter.accept({ vendorCode: 'V1', consigneeRouteCode: 'BB009' }), true)
})

test('buildScopeFilter: 兜底命中但该路由在白名单里——仍然剔除，不显示点位', () => {
  const filter = buildScopeFilter({ vendorCode: 'V1', routeCodes: ['R1'], routeCodeWhitelist: ['BB009'] })
  assert.equal(filter.accept({ vendorCode: 'V1', consigneeRouteCode: 'BB009' }), false)
})

test('buildScopeFilter: vendorCode 不匹配时不兜底，正常剔除', () => {
  const filter = buildScopeFilter({ vendorCode: 'V1', routeCodes: ['R1'] })
  assert.equal(filter.accept({ vendorCode: 'V9', consigneeRouteCode: 'R1' }), false)
})

test('buildScopeFilter: 未派件（vendorCode 为空）时按路由码兜底归属', () => {
  const filter = buildScopeFilter({ vendorCode: 'V1', routeCodes: ['R1'] })
  assert.equal(filter.accept({ vendorCode: '', consigneeRouteCode: 'R1' }), true)
  assert.equal(filter.accept({ vendorCode: '', consigneeRouteCode: 'R9' }), false)
})

test('buildScopeFilter: 只配路由码、未选供应商——只认路由码，不看承运商', () => {
  const filter = buildScopeFilter({ vendorCode: '', routeCodes: ['R1'] })
  assert.equal(filter.accept({ vendorCode: 'V1', consigneeRouteCode: 'R1' }), true)
  assert.equal(filter.accept({ vendorCode: 'V9', consigneeRouteCode: 'R1' }), true)
  assert.equal(filter.accept({ vendorCode: 'V1', consigneeRouteCode: 'R9' }), false)
})
