import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  summarizeReconciliation,
  type ReconciliationRow,
} from './reconciliationService'

function row(patch: Partial<ReconciliationRow>): ReconciliationRow {
  return {
    counterpartyId: 'c1',
    counterpartyName: '悉尼',
    counterpartyKind: 'INTERNAL_WAREHOUSE',
    containerType: 'BIG_BASKET',
    outQty: 0,
    inQty: 0,
    pendingOut: 0,
    pendingIn: 0,
    ...patch,
  }
}

test('借出与归还等量时净额归零，两个方向都不计欠账', () => {
  const result = summarizeReconciliation([row({ outQty: 100, inQty: 100 })])

  assert.equal(result.rows[0].net, 0)
  assert.equal(result.owedToMe.BIG_BASKET, 0)
  assert.equal(result.owedByMe.BIG_BASKET, 0)
})

test('我转出得多 → 对方欠我，只进 owedToMe', () => {
  const result = summarizeReconciliation([row({ outQty: 100, inQty: 70 })])

  assert.equal(result.rows[0].net, 30)
  assert.equal(result.owedToMe.BIG_BASKET, 30)
  assert.equal(result.owedByMe.BIG_BASKET, 0)
})

test('我转入得多 → 我欠对方，owedByMe 记正数', () => {
  const result = summarizeReconciliation([row({ outQty: 20, inQty: 32 })])

  assert.equal(result.rows[0].net, -12)
  assert.equal(result.owedByMe.BIG_BASKET, 12)
  assert.equal(result.owedToMe.BIG_BASKET, 0)
})

test('两个品类分别合计，不互相抵消', () => {
  const result = summarizeReconciliation([
    row({ containerType: 'BIG_BASKET', outQty: 50, inQty: 10 }),
    row({ containerType: 'SILVER_BOX', outQty: 5, inQty: 25 }),
  ])

  assert.equal(result.owedToMe.BIG_BASKET, 40)
  assert.equal(result.owedByMe.BIG_BASKET, 0)
  assert.equal(result.owedToMe.SILVER_BOX, 0)
  assert.equal(result.owedByMe.SILVER_BOX, 20)
})

test('多个对手方同品类的欠账累加到一起', () => {
  const result = summarizeReconciliation([
    row({ counterpartyId: 'c1', outQty: 30, inQty: 0 }),
    row({ counterpartyId: 'c2', outQty: 12, inQty: 0 }),
    row({ counterpartyId: 'c3', outQty: 0, inQty: 8 }),
  ])

  assert.equal(result.owedToMe.BIG_BASKET, 42)
  assert.equal(result.owedByMe.BIG_BASKET, 8)
})

test('在途量完全不影响净额与两个合计', () => {
  const withoutPending = summarizeReconciliation([row({ outQty: 10, inQty: 4 })])
  const withPending = summarizeReconciliation([
    row({ outQty: 10, inQty: 4, pendingOut: 999, pendingIn: 888 }),
  ])

  assert.equal(withPending.rows[0].net, withoutPending.rows[0].net)
  assert.deepEqual(withPending.owedToMe, withoutPending.owedToMe)
  assert.deepEqual(withPending.owedByMe, withoutPending.owedByMe)
})

test('没有任何往来时两个方向都预置全品类的 0，前端不用处理 undefined', () => {
  const result = summarizeReconciliation([])

  assert.deepEqual(result.rows, [])
  assert.deepEqual(result.owedToMe, { BIG_BASKET: 0, SILVER_BOX: 0 })
  assert.deepEqual(result.owedByMe, { BIG_BASKET: 0, SILVER_BOX: 0 })
})
