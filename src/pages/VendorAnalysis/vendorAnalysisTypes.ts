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

export type FineBiVendorMetrics = {
  inboundVolume: number
  pickupVolume: number
  pickupRate: number
  onTimePickupVolume: number
  /** 11点前出仓率（FineBI：准时提货率） */
  before11ExitRate: number
}

export type FineBi24hDispatchMetrics = {
  firstOfdCnt: number
  in24hDldCnt: number
  /** 24WH派签率（FineBI formatText） */
  dispatchRate24hText: string
  /** 24小时签收未达标 */
  notMet24hSignCount: number
}

export type VendorMetricRow = {
  vendorCode: string
  vendorName: string
  complaintCount: number
  waybillCount: number
  complaintRate: number
  unprocessedTicketCount: number
  longTailCount: number
  /** 11点前出仓率，FineBI 未返回时为 null */
  before11ExitRate: number | null
  /** 24小时签派率（FineBI formatText），未返回时为 null */
  dispatchRate24hText: string | null
  /** 24小时签收未达标件数 */
  notMet24hSignCount: number | null
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
  [key: string]: unknown
}

export type WaybillRow = {
  courierVendorCode?: string
  courierCode?: string
  [key: string]: unknown
}

export type DriverWaybillRow = {
  courier?: string
  courierCode?: string
  courierVendor?: string
  courierVendorCode?: string
  routeCode?: string
  consigneeRouteCode?: string
  signDate?: string
  deliveryTime?: string
  [key: string]: unknown
}

export type DriverReturnRawRow = {
  driverName?: string
  driverCode?: string
  driverVendorName?: string
  driverVendorCode?: string
  ofdDate?: string
  [key: string]: unknown
}

export type DriverPerformanceRow = {
  courierCode: string
  courierName: string
  vendorCode: string
  vendorName: string
  routeCode: string
  ofdCount: number
  returnWarningCount: number
  dispatch24hCount: number
  totalDispatchCount: number
  dispatchRate24h: number | null
}
