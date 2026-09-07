import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import type { ContainerAccount } from '../../containerManagement/types'
import { i18n } from '../../i18n'
import {
  buildTransferImportTemplateBuffer,
  transferImportRefSheetName,
  transferImportSheetName,
} from './transferImportTemplate'

void i18n.changeLanguage('zh-CN')

const account = (id: string, name: string): ContainerAccount =>
  ({ id, name, kind: 'INTERNAL_WAREHOUSE', isExternal: false, boundUserIds: [] }) as ContainerAccount

test('下拉引用区域刚好覆盖名单行数，不带空白项', async () => {
  const own = [account('s1', '北岸仓')]
  const all = [account('s1', '北岸仓'), account('s2', '安华仓'), account('r1', '清关行')]
  const buffer = await buildTransferImportTemplateBuffer(own, all)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheetName = transferImportSheetName()
  const refSheetName = transferImportRefSheetName()
  const sheet = wb.getWorksheet(sheetName)!

  assert.deepEqual(sheet.getCell('C2').dataValidation?.formulae, [`=${refSheetName}!$A$2:$A$2`])
  assert.deepEqual(sheet.getCell('D2').dataValidation?.formulae, [`=${refSheetName}!$B$2:$B$4`])
  const ref = wb.getWorksheet(refSheetName)!
  assert.deepEqual([ref.getCell(2, 1).value], ['北岸仓'])
  assert.deepEqual(
    [2, 3, 4].map((row) => ref.getCell(row, 2).value),
    ['安华仓', '北岸仓', '清关行'],
  )
  assert.ok(sheet.getCell('C501').dataValidation)
  assert.ok(!sheet.getCell('C2').dataValidation?.showErrorMessage)
  assert.ok(!sheet.getCell('D2').dataValidation?.showErrorMessage)
  assert.equal(sheet.getCell('B2').dataValidation?.showErrorMessage, true)
})

test('名单为空时不写入非法区域', async () => {
  const buffer = await buildTransferImportTemplateBuffer([], [])
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.getWorksheet(transferImportSheetName())!
  assert.equal(sheet.getCell('C2').dataValidation, undefined)
  assert.equal(sheet.getCell('D2').dataValidation, undefined)
  assert.ok(sheet.getCell('B2').dataValidation, '业务类型下拉不受影响')
})

test('没绑定站点时转出方列没有下拉，接收方列照旧', async () => {
  const buffer = await buildTransferImportTemplateBuffer([], [account('s1', '北岸仓')])
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.getWorksheet(transferImportSheetName())!
  assert.equal(sheet.getCell('C2').dataValidation, undefined)
  assert.deepEqual(sheet.getCell('D2').dataValidation?.formulae, [
    `=${transferImportRefSheetName()}!$B$2:$B$2`,
  ])
})
