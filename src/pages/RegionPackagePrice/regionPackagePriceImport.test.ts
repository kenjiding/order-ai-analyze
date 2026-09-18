import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRegionPackagePriceMatrix, splitVendorCell } from './regionPackagePriceImport'

test('解析价格表原始表头并按 postcode+suburb 去重', () => {
  const result = parseRegionPackagePriceMatrix([
    ['postcode', 'suburb', 'price', 'vendor'],
    ['5000', 'ADELAIDE', '2.7', 'CAO XIAOHUA SRM2500934'],
    ['5000', 'adelaide', '3.1', '重复'],
    ['5001', 'ADELAIDE', '2.7', ''],
    ['5002', 'NO PRICE', '', 'x'],
    ['', '', '', ''],
  ])
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.prices, [
    {
      postcode: '5000',
      suburb: 'ADELAIDE',
      price: 2.7,
      courierPrice: 2.45,
      vendorCode: 'SRM2500934',
      vendorName: 'CAO XIAOHUA',
    },
    { postcode: '5001', suburb: 'ADELAIDE', price: 2.7, courierPrice: 2.45, vendorCode: '', vendorName: '' },
  ])
  assert.equal(result.duplicates, 1)
  assert.equal(result.invalid, 1)
  assert.equal(result.total, 4)
})

test('缺少必需列时报错', () => {
  assert.deepEqual(parseRegionPackagePriceMatrix([['suburb', 'price']]), {
    ok: false,
    error: 'missingPostcodeColumn',
  })
  assert.deepEqual(parseRegionPackagePriceMatrix([['postcode', 'suburb'], ['5000', 'A']]), {
    ok: false,
    error: 'missingPriceColumn',
  })
})

test('拆分 vendor 列的编码与名称', () => {
  assert.deepEqual(splitVendorCell('CAO XIAOHUA SRM2500934'), {
    vendorCode: 'SRM2500934',
    vendorName: 'CAO XIAOHUA',
  })
  assert.deepEqual(splitVendorCell('SPORT SERVICES PTY LTD | SRM2500649'), {
    vendorCode: 'SRM2500649',
    vendorName: 'SPORT SERVICES PTY LTD',
  })
  // 没有 SRM 编码的备注行整条留在名称里
  assert.deepEqual(splitVendorCell('KM $4.3: 200件到500件'), {
    vendorCode: '',
    vendorName: 'KM $4.3: 200件到500件',
  })
  assert.deepEqual(splitVendorCell(''), { vendorCode: '', vendorName: '' })
})

test('派送员价格：有列取列值，空则按 price - 0.25 推导', () => {
  const result = parseRegionPackagePriceMatrix([
    ['postcode', 'suburb', 'price', '派送员价格'],
    ['5000', 'A', '2.7', '2.0'],
    ['5001', 'B', '2.7', ''],
    // 0.25 以下的价格不能推出负数
    ['5002', 'C', '0.1', ''],
  ])
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(
    result.prices.map((p) => p.courierPrice),
    [2, 2.45, 0],
  )
})
