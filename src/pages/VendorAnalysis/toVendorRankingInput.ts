/**
 * VendorMetricRow / VendorSnapshotVendor → VendorRankingInput 的字段映射。
 * 派签率一律由达标量/总量计算，不解析展示用百分比文本。
 */
import {
  dispatchRateFromTotals,
  type VendorRankingInput,
} from '../../../shared/vendorAnalysis/rankingScore'

export type RankingSourceRow = {
  vendorCode: string
  complaintRate: number
  complaintCount: number
  waybillCount: number
  unprocessedTicketCount: number
  longTailCount: number
  before11ExitRate: number | null
  before11ExitVolume: number | null
  before11TotalReceived: number | null
  dispatch24hTotal: number | null
  dispatch24hCount: number | null
}

export function toVendorRankingInput(row: RankingSourceRow): VendorRankingInput {
  return {
    vendorCode: row.vendorCode,
    complaintRate: row.complaintRate,
    complaintCount: row.complaintCount,
    waybillCount: row.waybillCount,
    unprocessedTicketCount: row.unprocessedTicketCount,
    longTailCount: row.longTailCount,
    before11ExitRate: row.before11ExitRate,
    before11ExitVolume: row.before11ExitVolume,
    before11TotalReceived: row.before11TotalReceived,
    dispatchRate24h: dispatchRateFromTotals(row.dispatch24hCount, row.dispatch24hTotal),
    dispatch24hTotal: row.dispatch24hTotal,
    dispatch24hCount: row.dispatch24hCount,
  }
}
