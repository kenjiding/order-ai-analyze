import type { DriverPerformanceRow, VendorMetricRow, VendorPushConfig } from './vendorAnalysisTypes'
import type { FetchedData } from './useVendorAnalysisPage'

export type VendorSnapshotDriver = {
  courierCode: string
  courierName: string
  routeCode: string
  ofdCount: number
  before11OfdCount: number
  returnWarningCount: number
  dispatch24hCount: number
  totalDispatchCount: number
  dispatchRate24h: number | null
}

export type VendorSnapshotVendor = {
  vendorCode: string
  vendorName: string
  complaintRate: number
  complaintCount: number
  waybillCount: number
  before11ExitRate: number | null
  before11ExitVolume: number | null
  before11TotalReceived: number | null
  dispatchRate24hText: string | null
  notMet24hSignCount: number | null
  unprocessedTicketCount: number
  longTailCount: number
  isDisabled: boolean
  drivers: VendorSnapshotDriver[]
}

export type VendorSnapshotPushConfig = {
  vendorCode: string
  vendorName: string
  webhookUrl: string
  signingSecret: string | null
  isDisabled: boolean
}

export type VendorSnapshotData = {
  reportDate: string
  stations: string[]
  complaintDateRange: string
  before11Date: string
  dispatch24hDate: string
  vendors: VendorSnapshotVendor[]
  webhookConfigs: VendorSnapshotPushConfig[]
  generatedAt: string
  aiSummaries?: Record<string, string>
}

const STORAGE_KEY = 'vendorSnapshotData'

export function saveVendorSnapshot(data: VendorSnapshotData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Storage full or unavailable
  }
}

export function loadVendorSnapshot(): VendorSnapshotData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as VendorSnapshotData
  } catch {
    return null
  }
}

export function buildVendorSnapshot(params: {
  fetchedData: FetchedData
  stations: string[]
  vendorMetrics: VendorMetricRow[]
  driverPerformanceByVendor: Record<string, DriverPerformanceRow[]>
  configs: VendorPushConfig[]
  aiSummaries?: Record<string, string>
}): VendorSnapshotData {
  const { fetchedData, stations, vendorMetrics, driverPerformanceByVendor, configs, aiSummaries } = params
  const fmt = (s: string) => s.slice(5, 10).replace('-', '/')

  return {
    reportDate: fetchedData.before11Date,
    stations,
    complaintDateRange: `${fmt(fetchedData.ticketStartTime)}-${fmt(fetchedData.ticketEndTime)}`,
    before11Date: fetchedData.before11Date,
    dispatch24hDate: fetchedData.dayBeforeDate,
    generatedAt: new Date().toISOString(),
    aiSummaries,
    webhookConfigs: configs.map((c) => ({
      vendorCode: c.vendorCode,
      vendorName: c.vendorName,
      webhookUrl: c.webhookUrl,
      signingSecret: c.signingSecret,
      isDisabled: c.isDisabled,
    })),
    vendors: vendorMetrics.map((m) => ({
      vendorCode: m.vendorCode,
      vendorName: m.vendorName,
      complaintRate: m.complaintRate,
      complaintCount: m.complaintCount,
      waybillCount: m.waybillCount,
      before11ExitRate: m.before11ExitRate,
      before11ExitVolume: m.before11ExitVolume,
      before11TotalReceived: m.before11TotalReceived,
      dispatchRate24hText: m.dispatchRate24hText,
      notMet24hSignCount: m.notMet24hSignCount,
      unprocessedTicketCount: m.unprocessedTicketCount,
      longTailCount: m.longTailCount,
      isDisabled: m.isDisabled,
      drivers: (driverPerformanceByVendor[m.vendorCode] ?? []).map((d) => ({
        courierCode: d.courierCode,
        courierName: d.courierName,
        routeCode: d.routeCode,
        ofdCount: d.ofdCount,
        before11OfdCount: d.before11OfdCount,
        returnWarningCount: d.returnWarningCount,
        dispatch24hCount: d.dispatch24hCount,
        totalDispatchCount: d.totalDispatchCount,
        dispatchRate24h: d.dispatchRate24h,
      })),
    })),
  }
}
