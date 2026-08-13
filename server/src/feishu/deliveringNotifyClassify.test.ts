import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyDeliveringNotifyWaybill } from './deliveringNotifyClassify'

test('有派件时间且无签收 → out for delivery', () => {
  assert.equal(
    classifyDeliveringNotifyWaybill({ deliveryTime: '2026-08-13 10:00:00', signDate: '', lastScanStatusCode: '400' }),
    'outForDelivery',
  )
})

test('有派件时间且已签收 → skip，签收优先', () => {
  assert.equal(
    classifyDeliveringNotifyWaybill({
      deliveryTime: '2026-08-13 10:00:00',
      signDate: '2026-08-13 12:00:00',
      lastScanStatusCode: '1504',
    }),
    'skip',
  )
})

test('无派件时间 + lastScanStatusCode 1504/400 → 超大件未取', () => {
  assert.equal(
    classifyDeliveringNotifyWaybill({ deliveryTime: '', signDate: '', lastScanStatusCode: '1504' }),
    'oversizedUncollected',
  )
  assert.equal(
    classifyDeliveringNotifyWaybill({ deliveryTime: null, signDate: null, lastScanStatusCode: 400 }),
    'oversizedUncollected',
  )
})

test('无派件时间且扫描码不是 1504/400 → skip', () => {
  assert.equal(
    classifyDeliveringNotifyWaybill({ deliveryTime: '', signDate: '', lastScanStatusCode: '100' }),
    'skip',
  )
  assert.equal(classifyDeliveringNotifyWaybill({ deliveryTime: '', signDate: '' }), 'skip')
})
