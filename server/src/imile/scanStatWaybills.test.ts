import assert from 'node:assert/strict'
import test from 'node:test'
import { buildScanStatXlsx, groupScanStatWaybills } from './scanStatWaybills'

test('按商家编码归组，大小写合并，未识别和未查到分开', () => {
  const groups = groupScanStatWaybills(
    ['  W1 ', 'W1', 'W2', '', 'W3', 'W4'],
    [
      { waybillNo: 'W1', clientCode: 'c01', clientName: '' },
      { waybillNo: 'W2', clientCode: 'C01', clientName: '商家甲' },
      { waybillNo: 'W3', clientCode: '', clientName: '' },
    ],
  )
  assert.equal(groups.length, 3)
  assert.deepEqual(groups[0], {
    kind: 'merchant',
    clientCode: 'c01',
    clientName: '商家甲',
    waybillNos: ['W1', 'W2'],
  })
  assert.equal(groups[1]?.kind, 'unknown')
  assert.deepEqual(groups[1]?.waybillNos, ['W3'])
  assert.equal(groups[2]?.kind, 'unmatched')
  assert.deepEqual(groups[2]?.waybillNos, ['W4'])
})

test('表格一行一个运单，带商家编码和名称', () => {
  const buf = buildScanStatXlsx([
    { kind: 'merchant', clientCode: 'C01', clientName: '商家甲', waybillNos: ['W1', 'W2'] },
    { kind: 'unknown', clientCode: '', clientName: '未识别商家', waybillNos: ['W3'] },
    { kind: 'unmatched', clientCode: '', clientName: '未查到', waybillNos: ['W9'] },
  ])
  assert.equal(buf.subarray(0, 2).toString(), 'PK')
  const xml = buf.toString('utf8')
  assert.match(xml, /商家编码/)
  assert.match(xml, /商家甲/)
  assert.match(xml, /未识别商家/)
  assert.match(xml, />W1</)
  assert.match(xml, />W9</)
  assert.match(xml, /<c r="A4"[^>]*>[^<]*<is><t><\/t>/)
})
