import assert from 'node:assert/strict'
import test from 'node:test'
import { buildScanStatSupplierRouteStats } from './scanStatSupplierRouteStats'

function config(vendorCode: string, supplierNickname: string, routeCode: string) {
  return { vendorCode, vendorName: '', supplierNickname, routeCode }
}

test('按供应商分组，组内路由码按件数降序，供应商按总件数降序', () => {
  const configs = [config('V1', 'ADL-Lu', 'AA002 AA013'), config('V2', 'ADL-city', 'CC049')]
  const routeCodeByWaybill = new Map([
    ['W1', 'AA002'],
    ['W2', 'AA013'],
    ['W3', 'AA013'],
    ['W4', 'CC049'],
    ['W5', 'ZZ999'], // 未匹配任何供应商
  ])
  const stats = buildScanStatSupplierRouteStats(['W1', 'W2', 'W3', 'W4', 'W5', 'W6'], routeCodeByWaybill, configs)

  assert.equal(stats.suppliers.length, 2)
  assert.deepEqual(stats.suppliers[0], {
    supplierKey: 'V1::ADL-Lu',
    supplierName: 'ADL-Lu',
    total: 3,
    routes: [
      { routeCode: 'AA013', count: 2 },
      { routeCode: 'AA002', count: 1 },
    ],
  })
  assert.equal(stats.suppliers[1].supplierName, 'ADL-city')
  assert.equal(stats.suppliers[1].total, 1)

  assert.deepEqual(stats.unmatchedRoutes, [{ routeCode: 'ZZ999', count: 1 }])
  // W6 没查到路由码
  assert.equal(stats.noRouteCodeCount, 1)
})

test('同一路由码配给两家供应商时，两家各自计数（不排他）', () => {
  const configs = [config('V1', '供应商甲', 'AA001'), config('V2', '供应商乙', 'AA001')]
  const stats = buildScanStatSupplierRouteStats(['W1'], new Map([['W1', 'AA001']]), configs)
  assert.equal(stats.suppliers.length, 2)
  assert.equal(stats.suppliers[0].total, 1)
  assert.equal(stats.suppliers[1].total, 1)
})

test('不选供应商的纯路由码配置也能识别归属（不能整条丢弃）', () => {
  const configs = [{ vendorCode: '', vendorName: '', supplierNickname: 'ADL-测试', routeCode: 'BB026,BB030' }]
  const stats = buildScanStatSupplierRouteStats(['W1', 'W2'], new Map([['W1', 'BB026'], ['W2', 'BB030']]), configs)
  assert.equal(stats.suppliers.length, 1)
  assert.equal(stats.suppliers[0].supplierName, 'ADL-测试')
  assert.equal(stats.suppliers[0].total, 2)
})

test('这个功能只识别归属，不按 routeCodeWhitelist 剔除（白名单是告警口径，不是识别归属的依据）', () => {
  const configs = [
    { vendorCode: 'V1', vendorName: '', supplierNickname: 'ADL-Darren', routeCode: 'GG126', routeCodeWhitelist: 'GG126' },
  ]
  const stats = buildScanStatSupplierRouteStats(['W1'], new Map([['W1', 'GG126']]), configs)
  assert.equal(stats.suppliers.length, 1)
  assert.equal(stats.suppliers[0].supplierName, 'ADL-Darren')
  assert.equal(stats.suppliers[0].total, 1)
  assert.equal(stats.unmatchedRoutes.length, 0)
})
