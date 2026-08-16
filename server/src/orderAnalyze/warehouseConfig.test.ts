import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WAREHOUSE_CONFIG,
  applyLossTimeoutDaysOverride,
  createWarehouseProfileContext,
} from './warehouseConfig'

test('applyLossTimeoutDaysOverride 覆盖全局默认与各仓库阈值，不改原对象', () => {
  const originalDefault = DEFAULT_WAREHOUSE_CONFIG.global.defaultLossTimeoutDays
  const originalAdl = DEFAULT_WAREHOUSE_CONFIG.profiles.find((p) => p.hubId === 'adelaide_center')
  const overridden = applyLossTimeoutDaysOverride(DEFAULT_WAREHOUSE_CONFIG, 3)

  assert.equal(DEFAULT_WAREHOUSE_CONFIG.global.defaultLossTimeoutDays, originalDefault)
  assert.equal(originalAdl?.lossTimeoutDays, undefined)
  assert.equal(overridden.global.defaultLossTimeoutDays, 3)
  assert.ok(overridden.profiles.every((profile) => profile.lossTimeoutDays === 3))
  assert.equal(overridden.global.externalCarrierLossTimeoutDays, DEFAULT_WAREHOUSE_CONFIG.global.externalCarrierLossTimeoutDays)
})

test('applyLossTimeoutDaysOverride 后责任仓库丢失超时读取覆盖值', () => {
  const ctx = createWarehouseProfileContext(applyLossTimeoutDaysOverride(DEFAULT_WAREHOUSE_CONFIG, 4))
  const adelaide = ctx.findWarehouseProfileByName('Adelaide Center')
  assert.equal(ctx.getWarehouseLossTimeoutDays(adelaide), 4)
  assert.equal(ctx.getWarehouseLossTimeoutDays(null), 4)
})
