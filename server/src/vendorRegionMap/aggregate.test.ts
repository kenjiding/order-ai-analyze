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

test('同一邮编下不同 suburb 按各自单价计价，且各自出一个 cell（密度/柱体要按郊区分开算，不能合并成一个邮区大面）', () => {
  const result = aggregateVendorZipCells({
    records: [
      scan({ waybillNo: 'A1', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1' }),
      scan({ waybillNo: 'A2', zip: '5000', suburb: 'North Adelaide', vendorCode: 'SRM1' }),
    ],
    configs: [config('SRM1')],
    priceBook,
  })

  const cells = result.cells.filter((item) => item.zipCode === '5000')
  assert.equal(cells.length, 2, '两个郊区各出一个 cell，不再合并成同一个邮区大面')
  const adelaide = cells.find((item) => item.suburb === 'ADELAIDE')
  const northAdelaide = cells.find((item) => item.suburb === 'NORTH ADELAIDE')
  assert.equal(adelaide?.count, 1)
  assert.equal(adelaide?.vendorProfit, 0.5)
  assert.equal(adelaide?.courierProfit, 2.5)
  assert.equal(northAdelaide?.count, 1)
  assert.equal(northAdelaide?.vendorProfit, 1)
  assert.equal(northAdelaide?.courierProfit, 4)
  // 均价会给出 (3-2.5 + 5-4) 之外的错数；逐单算才得到 0.5 + 1，两个 cell 加总要对得上
  assert.equal((adelaide?.vendorProfit ?? 0) + (northAdelaide?.vendorProfit ?? 0), 1.5)
  assert.equal((adelaide?.courierProfit ?? 0) + (northAdelaide?.courierProfit ?? 0), 6.5)
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

test('路由码维度的利润按同一 priced 口径累加，跟对应 cell 的利润对得上', () => {
  const result = aggregateVendorZipCells({
    records: [
      scan({ waybillNo: 'A1', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1', routeCode: 'R1' }),
      scan({ waybillNo: 'A2', zip: '5000', suburb: 'Adelaide', vendorCode: 'SRM1', routeCode: 'R1' }),
    ],
    configs: [config('SRM1')],
    priceBook,
  })

  const cell = result.cells.find((item) => item.zipCode === '5000')
  const r1 = result.routes.find((item) => item.routeCode === 'R1')
  // 单价 3/2.5，两票：供应商利润 (3-2.5)*2=1，司机利润 2.5*2=5
  assert.equal(r1?.vendorProfit, 1)
  assert.equal(r1?.courierProfit, 5)
  assert.equal(r1?.vendorProfit, cell?.vendorProfit)
  assert.equal(r1?.courierProfit, cell?.courierProfit)
})

test('路由码维度未匹配到价格的票计入 unpricedCount，不静默按 0 处理', () => {
  const result = aggregateVendorZipCells({
    records: [scan({ waybillNo: 'A1', zip: '5000', suburb: 'Unknown Suburb', vendorCode: 'SRM1', routeCode: 'R1' })],
    configs: [config('SRM1')],
    priceBook,
  })

  const r1 = result.routes.find((item) => item.routeCode === 'R1')
  assert.equal(r1?.unpricedCount, 1)
  assert.equal(r1?.vendorProfit, 0)
  assert.equal(r1?.courierProfit, 0)
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

test('同一路由码横跨两个郊区时按郊区拆成两行，不共用一个点；郊区名归一化大小写', () => {
  const result = aggregateVendorZipCells({
    records: [
      // 同一邮区（5114）同时覆盖 Craigmore 和 One Tree Hill 两个郊区——路由码要能分清这两边
      scan({ waybillNo: 'A1', zip: '5114', suburb: 'Craigmore', vendorCode: 'SRM1', routeCode: 'AA011' }),
      scan({ waybillNo: 'A2', zip: '5114', suburb: 'craigmore', vendorCode: 'SRM1', routeCode: 'AA011' }),
      scan({ waybillNo: 'A3', zip: '5114', suburb: 'One Tree Hill', vendorCode: 'SRM1', routeCode: 'AA011' }),
    ],
    configs: [config('SRM1')],
    priceBook,
  })

  const aa011 = result.routes.filter((item) => item.routeCode === 'AA011')
  assert.equal(aa011.length, 2, '同一路由码在两个郊区各出一行，不合并成一行')
  const craigmore = aa011.find((item) => item.suburb === 'CRAIGMORE')
  const oneTreeHill = aa011.find((item) => item.suburb === 'ONE TREE HILL')
  // 大小写不同（Craigmore / craigmore）的两条要归一化合并成一行
  assert.equal(craigmore?.count, 2)
  assert.equal(oneTreeHill?.count, 1)
  // 郊区质心是 router 层异步查 ABS 才补上的，纯聚合函数这里必须留空，不能伪造坐标
  assert.equal(craigmore?.lat, null)
  assert.equal(craigmore?.lng, null)
})

test('同一路由码大小写/首尾空格不同时要归一化合并，不能拆成两行', () => {
  const result = aggregateVendorZipCells({
    records: [
      scan({ waybillNo: 'A1', zip: '2488', suburb: 'Cabarita Beach', vendorCode: 'SRM1', routeCode: 'AA011' }),
      scan({ waybillNo: 'A2', zip: '2488', suburb: 'Cabarita Beach', vendorCode: 'SRM1', routeCode: ' aa011 ' }),
    ],
    configs: [config('SRM1')],
    priceBook,
  })

  const aa011 = result.routes.filter((item) => item.routeCode === 'AA011')
  assert.equal(aa011.length, 1, '大小写/空格不同的路由码要合并成一行，不能各算一行')
  assert.equal(aa011[0]?.count, 2)
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
