import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRouteCodeVendorsMap,
  buildScopeMapsFromConfig,
  buildScopeRecordsFromConfigs,
  buildSupplierUnitIndex,
  buildSupplierUnitKey,
  isRowInConfigScope,
  parseSupplierUnits,
  serializeSupplierUnits,
  supplierUnitsToScopes,
  isRowInVendorScope,
  resolveVendorCodesByRouteCode,
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

test('isRowInConfigScope: 同 vendorCode 不同路由码的两条配置互不串数据（ADL-City / ADL-Lu）', () => {
  const city = { vendorCode: 'SRM2401068', routeCodes: new Set(['ADL-C1', 'ADL-C2']) }
  const lu = { vendorCode: 'SRM2401068', routeCodes: new Set(['ADL-L1']) }

  // City 的单只算进 City，不算进 Lu
  assert.equal(isRowInConfigScope(city, 'SRM2401068', 'ADL-C1'), true)
  assert.equal(isRowInConfigScope(lu, 'SRM2401068', 'ADL-C1'), false)
  // Lu 的单反过来同理
  assert.equal(isRowInConfigScope(lu, 'SRM2401068', 'ADL-L1'), true)
  assert.equal(isRowInConfigScope(city, 'SRM2401068', 'ADL-L1'), false)
  // 两家都没配的路由码，谁都不算
  assert.equal(isRowInConfigScope(city, 'SRM2401068', 'ADL-X9'), false)
  assert.equal(isRowInConfigScope(lu, 'SRM2401068', 'ADL-X9'), false)
})

test('isRowInConfigScope: 承运商已回填时必须精确等于本 scope 的 vendorCode', () => {
  const s = { vendorCode: 'V1', routeCodes: new Set(['R1']) }
  assert.equal(isRowInConfigScope(s, 'V2', 'R1'), false)
  assert.equal(isRowInConfigScope(s, ' V1 ', ' R1 '), true)
})

test('isRowInConfigScope: 承运商为空时按 routeCode 兜底归属，未配纳入名单则不兜底', () => {
  const withRoutes = { vendorCode: 'V1', routeCodes: new Set(['R1']) }
  assert.equal(isRowInConfigScope(withRoutes, '', 'R1'), true)
  assert.equal(isRowInConfigScope(withRoutes, '', 'R2'), false)

  const noRoutes = { vendorCode: 'V1' }
  assert.equal(isRowInConfigScope(noRoutes, '', 'R1'), false)
  // 未配纳入名单时，承运商已回填的行仍按 vendorCode 全量纳入（= 不收窄）
  assert.equal(isRowInConfigScope(noRoutes, 'V1', 'R1'), true)
})

test('isRowInConfigScope: 白名单命中整行剔除，优先级高于纳入命中', () => {
  const s = { vendorCode: 'V1', routeCodes: new Set(['R1']), routeCodeWhitelist: new Set(['R1']) }
  assert.equal(isRowInConfigScope(s, 'V1', 'R1'), false)
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

test('buildRouteCodeVendorsMap: routeCode 唯一归属某供应商时反查出单个；同一路由码配置在多个供应商时反查出全部（两家共担同一路由属正常业务）', () => {
  const map = buildRouteCodeVendorsMap(
    new Map([
      ['V1', new Set(['R1', 'R2'])],
      ['V2', new Set(['R2', 'R3'])], // R2 同时属于 V1、V2：两家共担
    ]),
  )
  assert.deepEqual(resolveVendorCodesByRouteCode('R1', map), ['V1'])
  assert.deepEqual(resolveVendorCodesByRouteCode('R2', map).sort(), ['V1', 'V2']) // 共担路由：两家都命中
  assert.deepEqual(resolveVendorCodesByRouteCode('R3', map), ['V2'])
  assert.deepEqual(resolveVendorCodesByRouteCode('R9', map), []) // 未配置的路由
  assert.deepEqual(resolveVendorCodesByRouteCode('', map), [])
  assert.deepEqual(resolveVendorCodesByRouteCode(' R1 ', map), ['V1']) // 前后空白容错
})

function unitConfig(input: {
  vendorCode: string
  supplierNickname?: string
  vendorName?: string
  routeCode?: string
  routeCodeWhitelist?: string
}) {
  return {
    vendorCode: input.vendorCode,
    vendorName: input.vendorName ?? input.vendorCode,
    supplierNickname: input.supplierNickname ?? '',
    routeCode: input.routeCode ?? '',
    routeCodeWhitelist: input.routeCodeWhitelist ?? '',
  } as never
}

test('buildSupplierUnitIndex: 同 vendorCode 不同展示名 = 两个单位；同展示名的多条配置归并、路由码取并集', () => {
  const index = buildSupplierUnitIndex([
    unitConfig({ vendorCode: 'SRM01', supplierNickname: 'ADL-City', routeCode: 'C1' }),
    // 同一家在另一个 region 又建了一条，路由码取并集，仍是一个单位
    unitConfig({ vendorCode: 'SRM01', supplierNickname: 'ADL-City', routeCode: 'C2' }),
    unitConfig({ vendorCode: 'SRM01', supplierNickname: 'ADL-Lu', routeCode: 'L1' }),
  ])
  assert.equal(index.units.size, 2)
  const city = index.units.get(buildSupplierUnitKey('SRM01', 'ADL-City'))
  assert.ok(city)
  assert.deepEqual([...city.routeCodes].sort(), ['C1', 'C2'])

  // 归属：同编码靠路由码分到各自单位，互不串
  assert.deepEqual(index.resolve('SRM01', 'C1'), [buildSupplierUnitKey('SRM01', 'ADL-City')])
  assert.deepEqual(index.resolve('SRM01', 'C2'), [buildSupplierUnitKey('SRM01', 'ADL-City')])
  assert.deepEqual(index.resolve('SRM01', 'L1'), [buildSupplierUnitKey('SRM01', 'ADL-Lu')])
  // 两家都没配的路由码 → 不属于任何一家
  assert.deepEqual(index.resolve('SRM01', 'X9'), [])
})

test('buildSupplierUnitIndex: 承运商未回填时按路由码兜底归属', () => {
  const index = buildSupplierUnitIndex([
    unitConfig({ vendorCode: 'SRM01', supplierNickname: 'ADL-City', routeCode: 'C1' }),
    unitConfig({ vendorCode: 'SRM01', supplierNickname: 'ADL-Lu', routeCode: 'L1' }),
  ])
  assert.deepEqual(index.resolve('', 'L1'), [buildSupplierUnitKey('SRM01', 'ADL-Lu')])
  assert.deepEqual(index.resolve('', 'X9'), [])
})

test('buildSupplierUnitIndex: resolve 剔除白名单，resolveIgnoringWhitelist 不剔除', () => {
  const index = buildSupplierUnitIndex([
    unitConfig({ vendorCode: 'V1', supplierNickname: 'A', routeCode: 'R1 R2', routeCodeWhitelist: 'R1' }),
  ])
  const key = buildSupplierUnitKey('V1', 'A')
  assert.deepEqual(index.resolve('V1', 'R2'), [key])
  assert.deepEqual(index.resolve('V1', 'R1'), [])
  // 揽收量/司机归属走这个入口：白名单路由仍然算这一家的
  assert.deepEqual(index.resolveIgnoringWhitelist('V1', 'R1'), [key])
})

test('buildSupplierUnitIndex: 两家不同编码共担同一路由码时各自独立命中，非互斥', () => {
  const index = buildSupplierUnitIndex([
    unitConfig({ vendorCode: 'V1', supplierNickname: 'A', routeCode: 'R1' }),
    unitConfig({ vendorCode: 'V2', supplierNickname: 'B', routeCode: 'R1' }),
  ])
  // 承运商已回填 → 只归属对应那家
  assert.deepEqual(index.resolve('V1', 'R1'), [buildSupplierUnitKey('V1', 'A')])
  // 承运商为空 → 两家各自独立计入
  assert.deepEqual(index.resolve('', 'R1').sort(), [
    buildSupplierUnitKey('V1', 'A'),
    buildSupplierUnitKey('V2', 'B'),
  ].sort())
})

test('serializeSupplierUnits / parseSupplierUnits: 往返后归属判定不变（任务 payload 冻结用）', () => {
  const index = buildSupplierUnitIndex([
    unitConfig({ vendorCode: 'SRM01', supplierNickname: 'ADL-City', routeCode: 'C1 C2', routeCodeWhitelist: 'C2' }),
    unitConfig({ vendorCode: 'SRM01', supplierNickname: 'ADL-Lu', routeCode: 'L1' }),
  ])
  const restored = parseSupplierUnits(JSON.parse(JSON.stringify(serializeSupplierUnits(index))))
  assert.equal(restored.units.size, 2)
  for (const [vendorCode, routeCode] of [['SRM01', 'C1'], ['SRM01', 'C2'], ['SRM01', 'L1'], ['', 'L1']] as const) {
    assert.deepEqual(restored.resolve(vendorCode, routeCode), index.resolve(vendorCode, routeCode))
  }
})

test('supplierUnitsToScopes: 每个单位一个独立范围，key 为 supplierKey', () => {
  const index = buildSupplierUnitIndex([
    unitConfig({ vendorCode: 'SRM01', supplierNickname: 'ADL-City', routeCode: 'C1' }),
    unitConfig({ vendorCode: 'SRM01', supplierNickname: 'ADL-Lu' }),
  ])
  const scopes = supplierUnitsToScopes(index)
  assert.equal(scopes.length, 2)
  const city = scopes.find((s) => s.key === buildSupplierUnitKey('SRM01', 'ADL-City'))
  assert.ok(city)
  assert.equal(city.vendorCode, 'SRM01')
  assert.deepEqual([...(city.routeCodes ?? [])], ['C1'])
  // 未配路由码 → 不收窄（routeCodes 为 undefined），与 buildScopeMapsFromConfig 语义一致
  const lu = scopes.find((s) => s.key === buildSupplierUnitKey('SRM01', 'ADL-Lu'))
  assert.equal(lu?.routeCodes, undefined)
})
