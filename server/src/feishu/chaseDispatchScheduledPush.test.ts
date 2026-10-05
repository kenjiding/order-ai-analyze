import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildChaseDispatchConfigScopes,
  resolveChaseDispatchConfigIds,
  type ChaseDispatchConfigScope,
} from './chaseDispatchScheduledPush'

function scopesOf(configs: Array<{ id: string; vendorCode: string; routeCode: string }>): ChaseDispatchConfigScope[] {
  return buildChaseDispatchConfigScopes(configs)
}

test('resolveChaseDispatchConfigIds: 正常归属——vendorCode 匹配且路由在纳入名单里', () => {
  const scopes = scopesOf([{ id: 'cfg-1', vendorCode: 'V1', routeCode: 'R1, R2' }])
  const result = resolveChaseDispatchConfigIds(scopes, 'V1', 'R1')
  assert.deepEqual(result, { configIds: new Set(['cfg-1']), isForeignRoute: false })
})

test('resolveChaseDispatchConfigIds: vendorCode 精确匹配但路由不在纳入名单里——兜底计入，不再整单丢弃', () => {
  const scopes = scopesOf([{ id: 'cfg-1', vendorCode: 'V1', routeCode: 'R1, R2' }])
  const result = resolveChaseDispatchConfigIds(scopes, 'V1', 'BB009')
  assert.deepEqual(result, { configIds: new Set(['cfg-1']), isForeignRoute: true })
})

test('resolveChaseDispatchConfigIds: vendorCode 不匹配——不计入任何配置', () => {
  const scopes = scopesOf([{ id: 'cfg-1', vendorCode: 'V1', routeCode: 'R1' }])
  const result = resolveChaseDispatchConfigIds(scopes, 'V9', 'R1')
  assert.deepEqual(result, { configIds: new Set(), isForeignRoute: false })
})

test('resolveChaseDispatchConfigIds: 同 vendorCode 两条配置（ADL-City/ADL-Lu），路由超出两边纳入名单——兜底只落一个 configId，不会两边重复计入', () => {
  const scopes = scopesOf([
    { id: 'cfg-city', vendorCode: 'V1', routeCode: 'R-CITY' },
    { id: 'cfg-lu', vendorCode: 'V1', routeCode: 'R-LU' },
  ])
  const result = resolveChaseDispatchConfigIds(scopes, 'V1', 'BB009')
  assert.equal(result.configIds.size, 1, '必须传全部配置一起判定，不能逐配置各自独立兜底导致重复计入两边')
  assert.deepEqual(result.configIds, new Set(['cfg-city']))
  assert.equal(result.isForeignRoute, true)
})

test('resolveChaseDispatchConfigIds: 同 vendorCode 两条配置，路由在其中一条的纳入名单里——只归属那一条，不触发兜底', () => {
  const scopes = scopesOf([
    { id: 'cfg-city', vendorCode: 'V1', routeCode: 'R-CITY' },
    { id: 'cfg-lu', vendorCode: 'V1', routeCode: 'R-LU' },
  ])
  const result = resolveChaseDispatchConfigIds(scopes, 'V1', 'R-LU')
  assert.deepEqual(result, { configIds: new Set(['cfg-lu']), isForeignRoute: false })
})

test('resolveChaseDispatchConfigIds: 两个不同 vendorCode 共担同一路由码（未派件兜底归属）——各自独立计入，不是互斥', () => {
  const scopes = scopesOf([
    { id: 'cfg-v1', vendorCode: 'V1', routeCode: 'R1' },
    { id: 'cfg-v2', vendorCode: 'V2', routeCode: 'R1' },
  ])
  const result = resolveChaseDispatchConfigIds(scopes, '', 'R1')
  assert.deepEqual(result, { configIds: new Set(['cfg-v1', 'cfg-v2']), isForeignRoute: false })
})

test('resolveChaseDispatchConfigIds: 未选供应商的配置（routeCode 纯路由口径）——只认路由码，不看承运商', () => {
  const scopes = scopesOf([{ id: 'cfg-route-only', vendorCode: '', routeCode: 'R1' }])
  assert.deepEqual(resolveChaseDispatchConfigIds(scopes, 'V9', 'R1'), {
    configIds: new Set(['cfg-route-only']),
    isForeignRoute: false,
  })
})

test('resolveChaseDispatchConfigIds: 未选供应商且未填路由码——谁都不匹配，不会吃下整站', () => {
  const scopes = scopesOf([{ id: 'cfg-empty', vendorCode: '', routeCode: '' }])
  assert.deepEqual(resolveChaseDispatchConfigIds(scopes, 'V9', 'R1'), { configIds: new Set(), isForeignRoute: false })
})

test('resolveChaseDispatchConfigIds: 选了供应商但未填路由码——视为不收窄，vendorCode 匹配即算（迁移时顺带修正的既有分歧，见函数注释）', () => {
  const scopes = scopesOf([{ id: 'cfg-1', vendorCode: 'V1', routeCode: '' }])
  assert.deepEqual(resolveChaseDispatchConfigIds(scopes, 'V1', '随便什么路由'), {
    configIds: new Set(['cfg-1']),
    isForeignRoute: false,
  })
})
