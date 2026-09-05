import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import type { ContainerAccount } from '../../containerManagement/types'
import {
  buildTransferImportTemplateBuffer,
  TRANSFER_IMPORT_SHEET,
} from './transferImportTemplate'

const account = (id: string, name: string): ContainerAccount =>
  ({ id, name, kind: 'INTERNAL_WAREHOUSE', isExternal: false, boundUserIds: [] }) as ContainerAccount

test('下拉引用区域刚好覆盖名单行数，不带空白项', async () => {
  const own = [account('s1', '北岸仓')]
  const all = [account('s1', '北岸仓'), account('s2', '安华仓'), account('r1', '清关行')]
  const buffer = await buildTransferImportTemplateBuffer(own, all)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.getWorksheet(TRANSFER_IMPORT_SHEET)!

  // 转出方只给自己绑定的站点（A 列），接收方给全部（B 列），两份名单范围不同
  assert.deepEqual(sheet.getCell('C2').dataValidation?.formulae, ['=站点账户!$A$2:$A$2'])
  assert.deepEqual(sheet.getCell('D2').dataValidation?.formulae, ['=站点账户!$B$2:$B$4'])
  // 名单按名称排序，滚动时不会中途从头再排一遍
  const ref = wb.getWorksheet('站点账户')!
  assert.deepEqual([ref.getCell(2, 1).value], ['北岸仓'])
  assert.deepEqual(
    [2, 3, 4].map((row) => ref.getCell(row, 2).value),
    ['安华仓', '北岸仓', '清关行'],
  )
  // 末行也要带上验证，否则用户填到后面就没有下拉了
  assert.ok(sheet.getCell('C501').dataValidation)
  // 站点列保留下拉但不拦手打（showErrorMessage 为假即不弹「取值不合法」）；业务类型列仍然严格
  assert.ok(!sheet.getCell('C2').dataValidation?.showErrorMessage)
  assert.ok(!sheet.getCell('D2').dataValidation?.showErrorMessage)
  assert.equal(sheet.getCell('B2').dataValidation?.showErrorMessage, true)
})

test('名单为空时不写入非法区域', async () => {
  const buffer = await buildTransferImportTemplateBuffer([], [])
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.getWorksheet(TRANSFER_IMPORT_SHEET)!
  assert.equal(sheet.getCell('C2').dataValidation, undefined)
  assert.equal(sheet.getCell('D2').dataValidation, undefined)
  assert.ok(sheet.getCell('B2').dataValidation, '业务类型下拉不受影响')
})

test('没绑定站点时转出方列没有下拉，接收方列照旧', async () => {
  const buffer = await buildTransferImportTemplateBuffer([], [account('s1', '北岸仓')])
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.getWorksheet(TRANSFER_IMPORT_SHEET)!
  assert.equal(sheet.getCell('C2').dataValidation, undefined)
  assert.deepEqual(sheet.getCell('D2').dataValidation?.formulae, ['=站点账户!$B$2:$B$2'])
})
