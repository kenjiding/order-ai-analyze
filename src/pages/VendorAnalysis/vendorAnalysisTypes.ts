export type StationOption = {
  label: string
  value: string
}

export type VendorOption = {
  vendorNameEn: string
  vendorCode: string
}

export type VendorPushConfig = {
  id: string
  vendorCode: string
  vendorName: string
  webhookUrl: string
  signingSecret: string | null
  pushDescription: string | null
  isDisabled: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type VendorPushConfigDraft = Omit<VendorPushConfig, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>

export type VendorMetrics = {
  complaintCount: number
  waybillCount: number
  complaintRate: number
}

export type Before11ExitRateResult = {
  before11ExitRate: number
  before11ExitVolume: number
  totalReceived: number
}

export type SlimPickupRow = {
  waybillNo: string
  courierCode: string
  courierVendorCode: string
  courier: string
  consigneeRouteCode: string
  before11Exit: boolean
}

export type Before11ExitRatesData = {
  ratesByVendor: Record<string, Before11ExitRateResult>
  pickupRows: SlimPickupRow[]
}

export type VendorMetricRow = {
  vendorCode: string
  vendorName: string
  complaintCount: number
  waybillCount: number
  complaintRate: number
  unprocessedTicketCount: number
  longTailCount: number
  /** 11点前出仓率，未返回时为 null */
  before11ExitRate: number | null
  before11ExitVolume: number | null
  before11TotalReceived: number | null
  /** 11点前未出仓单号列表（hover tooltip 用） */
  before11UnmetWaybillNos: string[]
  /** 24小时派签率文本，未返回时为 null */
  dispatchRate24hText: string | null
  /** 24小时签收未达标件数 */
  notMet24hSignCount: number | null
  /** 24小时派签统计：总量 */
  dispatch24hTotal: number | null
  /** 24小时派签统计：达标量 */
  dispatch24hCount: number | null
  /** 24小时未达标单号列表（hover tooltip 用） */
  dispatch24hUnmetWaybillNos: string[]
  /** 客诉单号列表（hover tooltip 用） */
  complaintOrderCodes: string[]
  isDisabled: boolean
}

export type ComplaintTicketRow = {
  relatedResponsibleHubCode?: string
  relatedResponsibleHubName?: string
  responsibleDeptName?: string
  responsibleDeptCode?: string
  responsibleUserName?: string
  responsibleUserCode?: string
  [key: string]: unknown
}

export type NormalUnprocessedTicketRow = {
  currentHandleStationCode?: string
  currentHandleStationName?: string
  currentHandleRegion?: string
  currentHandleCode?: string
  [key: string]: unknown
}

export type HubUnprocessedTicketRow = {
  relatedResponsibleHubCode?: string
  relatedResponsibleHubName?: string
  responsibleDeptName?: string
  responsibleDeptCode?: string
  responsibleUserName?: string
  responsibleUserCode?: string
  [key: string]: unknown
}

export type UnprocessedTicketsData = {
  normalTickets: NormalUnprocessedTicketRow[]
  complaintTickets: HubUnprocessedTicketRow[]
  arbitrationTickets: HubUnprocessedTicketRow[]
}

export type LongTailOrderRow = {
  driverVendorName?: string
  driverVendorCode?: string
  driverName?: string
  driverCode?: string
  waybillNo?: string
  [key: string]: unknown
}

export type WaybillRow = {
  courierVendorCode?: string
  courierCode?: string
  [key: string]: unknown
}

export type DriverWaybillRow = {
  waybillNo?: string
  courier?: string
  courierCode?: string
  courierVendor?: string
  courierVendorCode?: string
  routeCode?: string
  consigneeRouteCode?: string
  signDate?: string
  deliveryTime?: string
  lastScanSiteCode?: string
  lastScanSiteName?: string
  lastProblemDate?: string
  before11Exit?: boolean
  [key: string]: unknown
}

export type DriverReturnRawRow = {
  driverName?: string
  driverCode?: string
  driverVendorName?: string
  driverVendorCode?: string
  ofdDate?: string
  waybillNo?: string
  [key: string]: unknown
}

export type DriverPerformanceRow = {
  courierCode: string
  courierName: string
  vendorCode: string
  vendorName: string
  routeCode: string
  ofdCount: number
  ofdWaybillNos: string[]
  before11OfdCount: number
  /** 11点前未出仓单号列表（hover tooltip 用） */
  before11UnmetWaybillNos: string[]
  returnWarningCount: number
  /** 归班预警单号列表（hover tooltip 用） */
  returnWarningWaybillNos: string[]
  dispatch24hCount: number
  totalDispatchCount: number
  dispatchRate24h: number | null
  /** 24小时未达标单号列表（hover tooltip 用） */
  dispatch24hUnmetWaybillNos: string[]
  longTailCount: number
  /** 长尾单单号列表（hover tooltip 用） */
  longTailWaybillNos: string[]
}
