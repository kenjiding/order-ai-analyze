/**
 * DispatchSupplierNode → DispatchRankingInput 的字段映射。
 * DispatchMetrics 里的率字段是 0~100 的百分比，评分引擎吃 0~1 小数，这里统一换算。
 */
import type { DispatchRankingInput } from '../../../shared/dispatchPerformance/rankingScore'
import type { DispatchSupplierNode } from './dispatchPerformanceTypes'

function toFraction(pct: number | null): number | null {
  return pct == null ? null : pct / 100
}

export function toDispatchRankingInput(supplier: DispatchSupplierNode): DispatchRankingInput {
  return {
    supplierKey: supplier.supplierKey,
    vendorCode: supplier.vendorCode,
    supplierName: supplier.supplierName,
    before11ExitRate: toFraction(supplier.before11Rate),
    before11ExitMet: supplier.before11Met,
    before11Total: supplier.total,
    sameDayExitRate: toFraction(supplier.sameDayExitRate),
    sameDayExitMet: supplier.sameDayExitMet,
    sameDayExitTotal: supplier.total,
    signRate24h: toFraction(supplier.signRate),
    signMet24h: supplier.signMet,
    signTotal24h: supplier.total,
    nextDaySignRate: toFraction(supplier.nextDaySignRate),
    nextDaySignMet: supplier.nextDaySignMet,
    nextDaySignTotal: supplier.total,
    priorityNextDaySignRate: toFraction(supplier.priorityNextDaySignRate),
    priorityNextDaySignMet: supplier.priorityNextDaySignMet,
    priorityTotal: supplier.priorityTotal,
    vendorProfit: supplier.vendorProfit,
  }
}
