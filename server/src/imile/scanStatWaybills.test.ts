import assert from 'node:assert/strict'
import test from 'node:test'
import { buildScanStatSummaryText, groupScanStatWaybills } from './scanStatWaybills'

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

test('发飞书的文本带站点、总数、商家数，每组一行', () => {
  const text = buildScanStatSummaryText('深圳站', [
    { kind: 'merchant', clientCode: 'C01', clientName: '商家甲', waybillNos: ['W1', 'W2'] },
    { kind: 'unknown', clientCode: '', clientName: '未识别商家', waybillNos: ['W3'] },
    { kind: 'unmatched', clientCode: '', clientName: '未查到', waybillNos: ['W9'] },
  ])
  assert.match(text, /^深圳站 查询商家（共 4 单，1 个商家）：/)
  assert.match(text, /C01 商家甲（2）：W1、W2/)
  assert.match(text, /未识别商家（1）：W3/)
  assert.match(text, /未查到（1）：W9/)
})
