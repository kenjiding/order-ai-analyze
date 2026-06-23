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

export type VendorMetricRow = {
  vendorCode: string
  vendorName: string
  complaintCount: number
  waybillCount: number
  complaintRate: number
  unprocessedTicketCount: number
  longTailCount: number
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
