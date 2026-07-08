import type { AppLocale } from '../../i18n/types'
import type { VendorAiInput } from './vendorAnalysisApi'
import type { VendorSnapshotAiSummaries, VendorSnapshotVendor } from './vendorSnapshotStorage'

/**
 * 快照供应商行 → AI 输入。未勾选的指标字段直接省略（不发 0，避免误导模型）；
 * enabledSet 未传（老快照）→ 全量字段（改造前行为）。所有指标均可自由取消，无强制常开项。
 */
function sortDriversForAi(vendors: VendorSnapshotVendor[], enabledSet?: ReadonlySet<string>): VendorAiInput[] {
  const includeBefore11 = enabledSet?.has('vendor.before11ExitRate') ?? true
  const includeDispatch24h = enabledSet?.has('vendor.dispatch24h') ?? true
  const includeComplaintRate = enabledSet?.has('vendor.complaintRate') ?? true
  const includeUnprocessed = enabledSet?.has('vendor.unprocessedTickets') ?? true
  const includeVendorLongTail = enabledSet?.has('vendor.longTail') ?? true
  const includeTodayPickup = enabledSet?.has('driver.todayPickup') ?? true
  const includeDriverDispatch24h = enabledSet?.has('driver.dispatch24h') ?? true
  const includeReturnWarning = enabledSet?.has('driver.returnWarning') ?? true
  const includeDriverLongTail = enabledSet?.has('driver.longTail') ?? true
  return vendors.map((v) => {
    const sortedDrivers = [...v.drivers]
      .sort(
        (a, b) =>
          (b.returnWarningCount ?? 0) - (a.returnWarningCount ?? 0) ||
          (a.dispatchRate24h ?? 1) - (b.dispatchRate24h ?? 1),
      )
      .slice(0, 30)
    const dispatchRate24h = v.dispatchRate24hText ? parseFloat(v.dispatchRate24hText) / 100 : null
    return {
      vendorCode: v.vendorCode,
      vendorName: v.vendorName,
      ...(includeBefore11 ? { before11ExitRate: v.before11ExitRate } : {}),
      ...(includeDispatch24h ? { dispatchRate24h } : {}),
      ...(includeComplaintRate ? { complaintRate: v.complaintRate, complaintCount: v.complaintCount, waybillCount: v.waybillCount } : {}),
      ...(includeUnprocessed ? { unprocessedTicketCount: v.unprocessedTicketCount } : {}),
      ...(includeVendorLongTail ? { longTailCount: v.longTailCount } : {}),
      drivers: sortedDrivers.map((d) => ({
        courierName: d.courierName,
        courierCode: d.courierCode,
        routeCode: d.routeCode,
        ...(includeTodayPickup ? { ofdCount: d.ofdCount } : {}),
        ...(includeDriverDispatch24h
          ? { dispatchRate24h: d.dispatchRate24h, dispatch24hCount: d.dispatch24hCount, totalDispatchCount: d.totalDispatchCount }
          : {}),
        ...(includeReturnWarning ? { returnWarningCount: d.returnWarningCount } : {}),
        ...(includeDriverLongTail ? { longTailCount: d.longTailCount } : {}),
      })),
    }
  })
}

export function buildVendorAiInputsFromSnapshot(
  vendors: VendorSnapshotVendor[],
  enabledSet?: ReadonlySet<string>,
): VendorAiInput[] {
  return sortDriversForAi(vendors, enabledSet)
}

export function pickVendorAiSummary(
  summaries: VendorSnapshotAiSummaries | undefined,
  vendorCode: string,
  locale: AppLocale,
): string | undefined {
  const text = summaries?.[vendorCode]?.[locale]
  return text?.trim() ? text : undefined
}

export function mergeAiSummariesForLocale(
  existing: VendorSnapshotAiSummaries | undefined,
  locale: AppLocale,
  batch: Record<string, string>,
): VendorSnapshotAiSummaries {
  const out: VendorSnapshotAiSummaries = { ...(existing ?? {}) }
  for (const [code, text] of Object.entries(batch)) {
    if (!text.trim()) continue
    out[code] = { ...out[code], [locale]: text }
  }
  return out
}

export function hasAiSummariesForLocale(
  summaries: VendorSnapshotAiSummaries | undefined,
  vendors: VendorSnapshotVendor[],
  locale: AppLocale,
): boolean {
  if (!vendors.length) return true
  return vendors.every((v) => Boolean(pickVendorAiSummary(summaries, v.vendorCode, locale)))
}
