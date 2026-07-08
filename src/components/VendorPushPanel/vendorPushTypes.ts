export type VendorPushEntry = {
  id: string
  vendorCode: string
  vendorName: string
  /** 路由码，多个用英文逗号分隔，用于过滤运单数据 */
  routeCode: string
  webhookUrl: string
  signingSecret: string | null
  pushDescription: string | null
  isDisabled: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type VendorPushEntryDraft = Omit<VendorPushEntry, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>

export type VendorPushOption = {
  vendorCode: string
  vendorNameEn: string
}
