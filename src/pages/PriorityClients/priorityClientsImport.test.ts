import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePriorityClientMatrix } from './priorityClientsImport'

test('识别中英文表头并按编码去重', () => {
  const result = parsePriorityClientMatrix([
    ['商家编码 / Client Code', '商家名称 / Client Name', '备注'],
    ['C001', 'ZtoZ', 'x'],
    ['c001', '重复大小写', ''],
    ['C002', '', ''],
    ['', '', ''],
    ['', '只有名字', ''],
  ])
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.clients, [
    { clientCode: 'C001', clientName: 'ZtoZ' },
    { clientCode: 'C002', clientName: 'C002' },
  ])
  assert.equal(result.duplicates, 1)
  assert.equal(result.invalid, 1)
  assert.equal(result.total, 4)
})

test('识别 parent_client_code / parent_client_name', () => {
  const result = parsePriorityClientMatrix([
    ['parent_client_code', 'parent_client_name'],
    ['C100', '商家甲'],
  ])
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.clients, [{ clientCode: 'C100', clientName: '商家甲' }])
})

test('缺少编码列时报错', () => {
  const result = parsePriorityClientMatrix([['姓名', '电话'], ['a', 'b']])
  assert.deepEqual(result, { ok: false, error: 'missingCodeColumn' })
})
