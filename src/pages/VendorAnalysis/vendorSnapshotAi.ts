import type { AppLocale } from '../../i18n/types'
import type { VendorAiInput } from './vendorAnalysisApi'
import type { VendorSnapshotAiSummaries, VendorSnapshotVendor } from './vendorSnapshotStorage'

function sortDriversForAi(vendors: VendorSnapshotVendor[]): VendorAiInput[] {
  return vendors.map((v) => {
    const sortedDrivers = [...v.drivers]
      .sort(
        (a, b) =>
          b.returnWarningCount - a.returnWarningCount ||
          (a.dispatchRate24h ?? 1) - (b.dispatchRate24h ?? 1),
      )
      .slice(0, 30)
    const dispatchRate24h = v.dispatchRate24hText ? parseFloat(v.dispatchRate24hText) / 100 : null
    return {
      vendorCode: v.vendorCode,
      vendorName: v.vendorName,
      before11ExitRate: v.before11ExitRate,
      dispatchRate24h,
      complaintRate: v.complaintRate,
      complaintCount: v.complaintCount,
      waybillCount: v.waybillCount,
      unprocessedTicketCount: v.unprocessedTicketCount,
      longTailCount: v.longTailCount,
      drivers: sortedDrivers.map((d) => ({
        courierName: d.courierName,
        courierCode: d.courierCode,
        routeCode: d.routeCode,
        ofdCount: d.ofdCount,
        dispatchRate24h: d.dispatchRate24h,
        dispatch24hCount: d.dispatch24hCount,
        totalDispatchCount: d.totalDispatchCount,
        returnWarningCount: d.returnWarningCount,
        longTailCount: d.longTailCount,
      })),
    }
  })
}

export function buildVendorAiInputsFromSnapshot(vendors: VendorSnapshotVendor[]): VendorAiInput[] {
  return sortDriversForAi(vendors)
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
