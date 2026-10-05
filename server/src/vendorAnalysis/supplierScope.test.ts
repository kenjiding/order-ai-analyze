import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConfigScope,
  buildRouteCodeVendorsMap,
  buildScopeMapsFromConfig,
  buildScopeRecordsFromConfigs,
  buildSupplierUnitIndex,
  buildSupplierUnitKey,
  isRowInConfigScope,
  parseSupplierUnits,
  resolveConfigScopesForRow,
  serializeSupplierUnits,
  supplierUnitsToScopes,
  isRowInVendorScope,
  resolveVendorCodesByRouteCode,
  type ConfigScope,
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

test('未选供应商的配置：只按路由码匹配，无视运单上的承运商', () => {
  const scope = buildConfigScope('cfg-1', { vendorCode: '', routeCode: 'R1, R2', routeCodeWhitelist: 'R2' })
  assert.equal(scope.vendorCode, '')
  // 承运商是谁都不看，只认路由码
  assert.equal(isRowInConfigScope(scope, 'SRM01', 'R1'), true)
  assert.equal(isRowInConfigScope(scope, 'SRM99', 'R1'), true)
  assert.equal(isRowInConfigScope(scope, '', 'R1'), true)
  // 路由码不在纳入名单 → 不匹配
  assert.equal(isRowInConfigScope(scope, 'SRM01', 'R7'), false)
  // 白名单仍然生效
  assert.equal(isRowInConfigScope(scope, 'SRM01', 'R2'), false)
})

test('未选供应商且未填路由码：谁都不匹配，不会吃下整个站点', () => {
  const scope = buildConfigScope('cfg-2', { vendorCode: '', routeCode: '', routeCodeWhitelist: '' })
  assert.equal(isRowInConfigScope(scope, 'SRM01', 'R1'), false)
  assert.equal(isRowInConfigScope(scope, '', ''), false)
})

test('选了供应商的配置：口径不变，仍按承运商归属', () => {
  const scope = buildConfigScope('cfg-3', { vendorCode: 'SRM01', routeCode: 'R1', routeCodeWhitelist: '' })
  assert.equal(isRowInConfigScope(scope, 'SRM01', 'R1'), true)
  assert.equal(isRowInConfigScope(scope, 'SRM99', 'R1'), false)
  // 承运商为空 → 按路由码兜底
  assert.equal(isRowInConfigScope(scope, '', 'R1'), true)
})

// ── resolveConfigScopesForRow：归属判定 + 路由被收窄时兜底落到承运商名下 ──────────

function cfgScope(key: string, vendorCode: string, routeCodes?: string[], whitelist?: string[]): ConfigScope {
  return {
    key,
    vendorCode,
    routeCodes: routeCodes ? new Set(routeCodes) : undefined,
    routeCodeWhitelist: whitelist ? new Set(whitelist) : undefined,
  }
}

test('resolveConfigScopesForRow: 正常命中一个 scope，不触发兜底', () => {
  const scopes = [cfgScope('U1', 'V1', ['R1'])]
  const result = resolveConfigScopesForRow(scopes, 'V1', 'R1', { ignoreWhitelist: false })
  assert.equal(result.length, 1)
  assert.equal(result[0].scope.key, 'U1')
  assert.equal(result[0].isForeignRoute, false)
})

test('resolveConfigScopesForRow: 两家供应商共担同一路由码，正常判定应返回两个命中，不是只认一个', () => {
  const scopes = [cfgScope('U1', 'V1', ['R9']), cfgScope('U2', 'V2', ['R9'])]
  // 承运商未回填，靠路由码兜底归属（既有语义），两家各自独立命中
  const result = resolveConfigScopesForRow(scopes, '', 'R9', { ignoreWhitelist: false })
  assert.deepEqual(result.map((m) => m.scope.key).sort(), ['U1', 'U2'])
  assert.ok(result.every((m) => m.isForeignRoute === false))
})

test('resolveConfigScopesForRow: vendorCode 精确匹配但路由不在该供应商任何子配置名单里——兜底落到该供应商，标记 isForeignRoute', () => {
  // 同 vendorCode 下两条子配置（ADL-City / ADL-Lu 场景），都没配 BB009
  const scopes = [cfgScope('U1-City', 'V2', ['R2']), cfgScope('U1-Lu', 'V2', ['R3'])]
  const result = resolveConfigScopesForRow(scopes, 'V2', 'BB009', { ignoreWhitelist: false })
  assert.equal(result.length, 1, '只能落一个桶，不能两条子配置都给它算一遍导致重复计数')
  assert.equal(result[0].scope.key, 'U1-City', '落到 vendorCode 匹配的第一条（数组顺序=配置创建顺序）')
  assert.equal(result[0].isForeignRoute, true)
})

test('resolveConfigScopesForRow: vendorCode 在任何 scope 里都查不到——真正的配置缺失，不兜底，返回空', () => {
  const scopes = [cfgScope('U1', 'V1', ['BB009'])]
  const result = resolveConfigScopesForRow(scopes, 'V9', 'BB009', { ignoreWhitelist: false })
  assert.deepEqual(result, [])
})

test('resolveConfigScopesForRow: 未派件（vendorCode为空）零命中时不触发兜底——那是另一套既有逻辑，不在这里处理', () => {
  const scopes = [cfgScope('U1', 'V1', ['R1'])]
  const result = resolveConfigScopesForRow(scopes, '', 'R9', { ignoreWhitelist: false })
  assert.deepEqual(result, [])
})

test('resolveConfigScopesForRow: ignoreWhitelist=false 时，兜底命中的供应商若把这条路由配进了自己的白名单，兜底结果也要被剔除', () => {
  const scopes = [cfgScope('U1', 'V2', ['R2'], ['BB009'])]
  const result = resolveConfigScopesForRow(scopes, 'V2', 'BB009', { ignoreWhitelist: false })
  assert.deepEqual(result, [], '不能因为走了兜底分支就绕开白名单剔除')
})

test('resolveConfigScopesForRow: ignoreWhitelist=true 时，兜底正常返回 scope，白名单分桶交给调用方自己处理', () => {
  const scopes = [cfgScope('U1', 'V2', ['R2'], ['BB009'])]
  const result = resolveConfigScopesForRow(scopes, 'V2', 'BB009', { ignoreWhitelist: true })
  assert.equal(result.length, 1)
  assert.equal(result[0].isForeignRoute, true)
  // 调用方自己按 scope.routeCodeWhitelist 分桶（如滞留数据告警），这里只保证拿到了真实的 scope 对象
  assert.equal(result[0].scope.routeCodeWhitelist?.has('BB009'), true)
})

test('resolveConfigScopesForRow: 不要求 scope 带 key 字段，兼容司机地图现场拼的字面量 scope', () => {
  const literalScope = { vendorCode: 'V1', routeCodes: new Set(['R1']) }
  const result = resolveConfigScopesForRow([literalScope], 'V1', 'R1', { ignoreWhitelist: false })
  assert.equal(result.length, 1)
})
