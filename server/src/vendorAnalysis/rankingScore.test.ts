import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  densityPerThousand,
  dispatchRateFromTotals,
  rankVendors,
  scoreBefore11,
  scoreComplaintRate,
  scoreDensity,
  scoreDispatch24h,
  ticketsToBefore11Green,
  ticketsToDispatch24hGreen,
  type VendorRankingInput,
} from '../../../shared/vendorAnalysis/rankingScore'

function vendor(partial: Partial<VendorRankingInput> & { vendorCode: string }): VendorRankingInput {
  return {
    complaintRate: 0,
    complaintCount: 0,
    waybillCount: 1000,
    unprocessedTicketCount: 0,
    longTailCount: 0,
    before11ExitRate: 1,
    before11ExitVolume: 100,
    before11TotalReceived: 100,
    dispatchRate24h: 1,
    dispatch24hTotal: 100,
    dispatch24hCount: 100,
    ...partial,
  }
}

test('分项打分：绿线满分、黄线区间连续、红线递减', () => {
  assert.equal(scoreBefore11(0.99), 100)
  assert.ok(scoreBefore11(0.97) > 70 && scoreBefore11(0.97) < 100)
  assert.ok(scoreBefore11(0.9) >= 40)
  assert.equal(scoreDispatch24h(0.95), 100)
  assert.ok(scoreDispatch24h(0.93) > 70)
  assert.equal(scoreComplaintRate(0.00025), 100)
  assert.ok(scoreComplaintRate(0.0004) < 70)
  assert.equal(scoreDensity(0), 100)
  assert.equal(scoreDensity(2), 70)
})

test('距绿线票数：出仓/派签可执行翻译', () => {
  assert.equal(ticketsToBefore11Green(95, 100), 4)
  assert.equal(ticketsToBefore11Green(99, 100), 0)
  assert.equal(ticketsToDispatch24hGreen(90, 100), 5)
  assert.equal(ticketsToDispatch24hGreen(95, 100), 0)
})

test('千票密度：大体量绝对件数不必然低分', () => {
  const small = densityPerThousand(5, 100)
  const large = densityPerThousand(5, 5000)
  assert.ok(scoreDensity(large) > scoreDensity(small))
})

test('dispatchRateFromTotals：由达标量/总量得到率', () => {
  assert.equal(dispatchRateFromTotals(95, 100), 0.95)
  assert.equal(dispatchRateFromTotals(null, 100), null)
  assert.equal(dispatchRateFromTotals(0, 0), null)
})

test('综合排名：履约更好者靠前；小样本排在有效样本之后', () => {
  const pool = rankVendors([
    vendor({
      vendorCode: 'WEAK',
      before11ExitRate: 0.9,
      before11ExitVolume: 90,
      dispatchRate24h: 0.85,
      dispatch24hCount: 85,
      complaintRate: 0.0005,
      complaintCount: 1,
      unprocessedTicketCount: 20,
      longTailCount: 30,
    }),
    vendor({
      vendorCode: 'STRONG',
      before11ExitRate: 0.995,
      before11ExitVolume: 995,
      before11TotalReceived: 1000,
      dispatchRate24h: 0.98,
      dispatch24hTotal: 1000,
      dispatch24hCount: 980,
      complaintRate: 0.0001,
      waybillCount: 2000,
    }),
    vendor({
      vendorCode: 'TINY',
      waybillCount: 50,
      before11TotalReceived: 10,
      before11ExitVolume: 10,
      before11ExitRate: 1,
      dispatch24hTotal: 10,
      dispatch24hCount: 10,
      dispatchRate24h: 1,
      complaintRate: 0,
    }),
  ])

  assert.equal(pool.rankings[0]!.vendorCode, 'STRONG')
  assert.equal(pool.byKey.get('STRONG')!.rank, 1)
  assert.equal(pool.byKey.get('WEAK')!.rank, 2)
  assert.equal(pool.byKey.get('TINY')!.sampleInsufficient, true)
  assert.equal(pool.byKey.get('TINY')!.rank, 3)
  assert.ok(pool.byKey.get('STRONG')!.score > pool.byKey.get('WEAK')!.score)
})

test('指标取消后权重重归一化，仅对启用项打分', () => {
  const enabled = new Set(['vendor.dispatch24h', 'vendor.before11ExitRate'])
  const pool = rankVendors(
    [
      vendor({
        vendorCode: 'A',
        dispatchRate24h: 0.99,
        dispatch24hCount: 99,
        before11ExitRate: 0.995,
        before11ExitVolume: 99,
        before11TotalReceived: 100,
        complaintRate: 0.01,
        complaintCount: 10,
      }),
      vendor({
        vendorCode: 'B',
        dispatchRate24h: 0.9,
        dispatch24hCount: 90,
        before11ExitRate: 0.9,
        before11ExitVolume: 90,
        complaintRate: 0,
      }),
    ],
    enabled,
  )
  assert.equal(pool.byKey.get('A')!.rank, 1)
  const aComplaint = pool.byKey.get('A')!.breakdown.find((b) => b.key === 'vendor.complaintRate')
  assert.equal(aComplaint?.included, false)
})
