import assert from 'node:assert/strict'
import test from 'node:test'
import { dedupeBagsForSubmit, isBagFinishSuccess } from './bagFinish'

test('无阻断即成功：blockCode 为 0 或缺失都算退返商家成功', () => {
  assert.equal(isBagFinishSuccess({ ok: true, blockCode: 0 }), true)
  // 实测成功时 iMile 不返回 blockCode
  assert.equal(isBagFinishSuccess({ ok: true, blockCode: null }), true)
  assert.equal(isBagFinishSuccess({ ok: true }), true)
  assert.equal(isBagFinishSuccess({ ok: true, blockCode: 1 }), false)
  assert.equal(isBagFinishSuccess({ ok: false, blockCode: 0 }), false)
  assert.equal(isBagFinishSuccess(undefined), false)
})

test('提交前按集包号去重并剔除无商家编码的集包', () => {
  const bags = [
    { bagNumber: 'B1', targetCode: 'C2104005601', waybillTotalCount: 3 },
    { bagNumber: 'B1', targetCode: 'C2104005601', waybillTotalCount: 3 },
    { bagNumber: 'B2', targetCode: '', waybillTotalCount: 5 },
    { bagNumber: 'B3', targetCode: 'C2104008201', waybillTotalCount: 1 },
  ]
  assert.deepEqual(
    dedupeBagsForSubmit(bags).map((bag) => bag.bagNumber),
    ['B1', 'B3'],
  )
})
