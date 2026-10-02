import assert from 'node:assert/strict'
import test from 'node:test'
import { __setCircuitStateForTest, requestImileApi } from './client'

const BUSY_BODY = JSON.stringify({ status: 'failure', resultCode: '44882', message: 'The system is busy, try again later' })
const OK_BODY = JSON.stringify({ status: 'success' })

function mockFetch(body: string) {
  let calls = 0
  const fn = async () => {
    calls += 1
    return new Response(body, { status: 200 })
  }
  return { fn, count: () => calls }
}

test('熔断器：连续 3 次繁忙重试耗尽后，后续请求立即失败，不再打网络', async () => {
  const originalFetch = globalThis.fetch
  const url = 'https://ds.imile.com/__test__/circuit-open'
  const busy = mockFetch(BUSY_BODY)
  globalThis.fetch = busy.fn as unknown as typeof fetch
  try {
    for (let i = 0; i < 3; i += 1) {
      const res = await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })
      assert.equal(res.ok, false)
    }
    assert.equal(busy.count(), 3, '前 3 次应该都真的打了网络')

    const res4 = await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })
    assert.equal(res4.ok, false)
    if (!res4.ok) assert.match(res4.message, /熔断中/)
    assert.equal(busy.count(), 3, '熔断打开后第 4 次不应该再发起真实请求')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('熔断器：未达阈值前一次成功会清零计数，不会被提前熔断', async () => {
  const originalFetch = globalThis.fetch
  const url = 'https://ds.imile.com/__test__/circuit-reset'
  try {
    globalThis.fetch = mockFetch(BUSY_BODY).fn as unknown as typeof fetch
    await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })
    await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })

    globalThis.fetch = mockFetch(OK_BODY).fn as unknown as typeof fetch
    const okRes = await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })
    assert.equal(okRes.ok, true)

    const busyAgain = mockFetch(BUSY_BODY)
    globalThis.fetch = busyAgain.fn as unknown as typeof fetch
    for (let i = 0; i < 2; i += 1) {
      await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })
    }
    assert.equal(busyAgain.count(), 2, '计数已被成功重置，2 次繁忙不足以触发熔断')

    const res = await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })
    assert.equal(res.ok, false)
    if (!res.ok) assert.doesNotMatch(res.message, /熔断中/, '还没到阈值，不应该走熔断分支')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('熔断器：已经跳闸过一次后，冷却期结束探测一失败应立刻重新熔断，不需要再攒 3 次', async () => {
  const originalFetch = globalThis.fetch
  const url = 'https://ds.imile.com/__test__/circuit-retrip'
  try {
    const busy = mockFetch(BUSY_BODY)
    globalThis.fetch = busy.fn as unknown as typeof fetch
    for (let i = 0; i < 3; i += 1) {
      await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })
    }
    const opened = await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })
    assert.equal(opened.ok, false)
    if (!opened.ok) assert.match(opened.message, /熔断中/, '第一次跳闸应该已经生效')
    assert.equal(busy.count(), 3, '跳闸后不应该再发真实请求')

    // 模拟冷却期已过，下一次调用会正常放行去探测
    __setCircuitStateForTest(url, { openUntil: Date.now() - 1 })

    const probeFail = await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })
    assert.equal(probeFail.ok, false)
    if (!probeFail.ok) assert.doesNotMatch(probeFail.message, /熔断中/, '冷却期已过，这一次应该是真探测，不是熔断快速失败')
    assert.equal(busy.count(), 4, '探测应该真的打了一次网络')

    const shouldBeOpenAgain = await requestImileApi({ url, method: 'POST', headers: {}, label: '测试', busyRetryMax: 0 })
    assert.equal(shouldBeOpenAgain.ok, false)
    if (!shouldBeOpenAgain.ok) {
      assert.match(
        shouldBeOpenAgain.message,
        /熔断中/,
        '已经跳闸过一次，探测只失败了 1 次就应该立刻重新熔断，不需要再攒够 3 次',
      )
    }
    assert.equal(busy.count(), 4, '重新熔断后不应该再发真实请求')
  } finally {
    globalThis.fetch = originalFetch
  }
})
