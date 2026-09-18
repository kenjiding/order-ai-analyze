import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAttribution } from './attributionBreakdown'

test('四格由边际减出来，之和恒等于 total', () => {
  // 10 单：出仓准点 7（其中 5 次日达成），出仓晚 3（其中 1 赶回来了）
  const b = buildAttribution({ total: 10, before11Met: 7, nextDaySignMet: 6, crossMet: 5 })

  assert.equal(b.exitMetSignMet, 5)
  assert.equal(b.exitMetSignUnmet, 2, '出仓准点却没派掉')
  assert.equal(b.exitUnmetSignMet, 1, '出仓晚但赶回来了')
  assert.equal(b.exitUnmetSignUnmet, 2, '连锁失败')
  assert.equal(
    b.exitMetSignMet + b.exitMetSignUnmet + b.exitUnmetSignMet + b.exitUnmetSignUnmet,
    b.total,
  )
  assert.equal(b.inconsistent, false)
})

test('lift = 出仓准点组与出仓晚组的次日达成率之差', () => {
  const b = buildAttribution({ total: 10, before11Met: 7, nextDaySignMet: 6, crossMet: 5 })

  assert.equal(b.rate, 60)
  assert.equal(b.rateWhenExitMet, 71.43, '5/7')
  assert.equal(b.rateWhenExitUnmet, 33.33, '1/3')
  assert.equal(b.lift, 38.1)
})

test('某一组样本为空时不给 lift，而不是当成 0%', () => {
  // 全部准点出仓：没有「出仓晚」这一组可比
  const b = buildAttribution({ total: 5, before11Met: 5, nextDaySignMet: 4, crossMet: 4 })
  assert.equal(b.rateWhenExitMet, 80)
  assert.equal(b.rateWhenExitUnmet, null)
  assert.equal(b.lift, null)
})

test('无数据时率为 null，不是 0%', () => {
  const b = buildAttribution({ total: 0, before11Met: 0, nextDaySignMet: 0, crossMet: 0 })
  assert.equal(b.rate, null)
  assert.equal(b.lift, null)
  assert.equal(b.inconsistent, false)
})

test('交叉格缺失的老数据必须被标成不可信，而不是画出一张错的图', () => {
  // 交叉列上线前的行：crossMet 落库默认 0，但边际仍是真实值
  const b = buildAttribution({ total: 10, before11Met: 8, nextDaySignMet: 7, crossMet: 0 })
  assert.equal(b.exitUnmetSignUnmet, -5)
  assert.equal(b.inconsistent, true)
})
