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
  const senders = [account('s1', 'A仓'), account('s2', 'B仓')]
  const receivers = [account('r1', '清关行B'), account('r2', '客户C'), account('r3', '客户D')]
  const buffer = await buildTransferImportTemplateBuffer(senders, receivers)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.getWorksheet(TRANSFER_IMPORT_SHEET)!

  assert.deepEqual(sheet.getCell('C2').dataValidation?.formulae, ['=站点账户!$A$2:$A$3'])
  assert.deepEqual(sheet.getCell('D2').dataValidation?.formulae, ['=站点账户!$C$2:$C$4'])
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
  assert.ok(sheet.getCell('B2').dataValidation, '业务类型下拉不受影响')
})
