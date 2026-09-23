import assert from 'node:assert/strict'
import test from 'node:test'
import { priceBookKey, type PackagePrice } from '../dispatch24hStats/aggregateCells'
import { aggregateVendorZipCells } from './aggregate'
import type { ScopeConfig } from './supplierMatcher'

function config(vendorCode: string): ScopeConfig {
  return {
    vendorCode,
    vendorName: vendorCode,
    supplierNickname: '',
    routeCode: '',
  }
}

function scan(input: {
  waybillNo: string
  zip: string
  suburb: string
  vendorCode: string
  routeCode?: string
  deliveryStation?: string
}) {
  return {
    waybillNo: input.waybillNo,
    consigneeZipCode: input.zip,
    consigneeCity: input.suburb,
    courierVendorCode: input.vendorCode,
    routeCode: input.routeCode ?? 'R1',
    deliveryStation: input.deliveryStation ?? '',
  }
}

const priceBook = new Map<string, PackagePrice>([
  [priceBookKey('5000', 'ADELAIDE'), { price: 3, courierPrice: 2.5 }],
  // 同一邮编下的第二个 suburb 单价不同 —— 这正是「不能先按邮编汇总票数再乘单价」的原因
  [priceBookKey('5000', 'NORTH ADELAIDE'), { price: 5, courierPrice: 4 }],
])

test('同一邮编下不同 suburb 按各自单价计价', () => {
  const result = aggregateVendorZipCells({
    records: [
      scan({ waybillNo: 'A1', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1' }),
      scan({ waybillNo: 'A2', zip: '5000', suburb: 'North Adelaide', vendorCode: 'SRM1' }),
    ],
    configs: [config('SRM1')],
    priceBook,
  })

  const cell = result.cells.find((item) => item.zipCode === '5000')
  assert.ok(cell)
  assert.equal(cell.count, 2)
  // 均价会给出 (3-2.5 + 5-4) 之外的错数；逐单算才得到 0.5 + 1
  assert.equal(cell.vendorProfit, 1.5)
  assert.equal(cell.courierProfit, 6.5)
  assert.equal(cell.unpricedCount, 0)
  assert.equal(result.unpricedPackages, 0)
})

test('没匹配到单价的票计入 unpriced，不按 0 元静默吞掉', () => {
  const result = aggregateVendorZipCells({
    records: [
      scan({ waybillNo: 'A1', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1' }),
      // 价格表里没有 5999，钱不能算
      scan({ waybillNo: 'A2', zip: '5999', suburb: 'Nowhere', vendorCode: 'SRM1' }),
    ],
    configs: [config('SRM1')],
    priceBook,
  })

  assert.equal(result.unpricedPackages, 1)
  assert.equal(result.cells.find((item) => item.zipCode === '5999')?.unpricedCount, 1)
  assert.equal(result.cells.find((item) => item.zipCode === '5999')?.vendorProfit, 0)

  const vendor = result.vendors[0]
  assert.equal(vendor?.packageCount, 2)
  assert.equal(vendor?.unpricedCount, 1)
  assert.equal(vendor?.vendorProfit, 0.5)
  assert.equal(vendor?.courierProfit, 2.5)
})

test('路由码按 供应商+邮区+路由码 聚合票量，空路由码不产出标签数据', () => {
  const result = aggregateVendorZipCells({
    records: [
      scan({ waybillNo: 'A1', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1', routeCode: 'R1' }),
      scan({ waybillNo: 'A2', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1', routeCode: 'R1' }),
      scan({ waybillNo: 'A3', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1', routeCode: 'R2' }),
      scan({ waybillNo: 'A4', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1', routeCode: '' }),
    ],
    configs: [config('SRM1')],
    priceBook,
  })

  assert.equal(result.routes.length, 2)
  const r1 = result.routes.find((item) => item.routeCode === 'R1')
  const r2 = result.routes.find((item) => item.routeCode === 'R2')
  assert.equal(r1?.count, 2)
  assert.equal(r1?.zipCode, '5000')
  assert.equal(r1?.supplierKey, r2?.supplierKey)
  assert.equal(r2?.count, 1)
})

test('路由码带出 deliveryStation，且同一路由码取首次出现的值，不因后续扫描缺失被覆盖成空', () => {
  const result = aggregateVendorZipCells({
    records: [
      scan({ waybillNo: 'A1', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1', routeCode: 'R1', deliveryStation: 'ADL DS' }),
      scan({ waybillNo: 'A2', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1', routeCode: 'R1', deliveryStation: '' }),
      scan({ waybillNo: 'A3', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1', routeCode: 'R2' }),
    ],
    configs: [config('SRM1')],
    priceBook,
  })

  const r1 = result.routes.find((item) => item.routeCode === 'R1')
  const r2 = result.routes.find((item) => item.routeCode === 'R2')
  assert.equal(r1?.deliveryStation, 'ADL DS')
  assert.equal(r2?.deliveryStation, '')
})

test('价格表缺省时全部票记为未计价，金额恒为 0', () => {
  const result = aggregateVendorZipCells({
    records: [scan({ waybillNo: 'A1', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1' })],
    configs: [config('SRM1')],
  })

  assert.equal(result.unpricedPackages, 1)
  assert.equal(result.vendors[0]?.vendorProfit, 0)
  assert.equal(result.vendors[0]?.courierProfit, 0)
})
