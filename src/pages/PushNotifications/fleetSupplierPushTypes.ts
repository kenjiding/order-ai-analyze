export type FleetSupplierConfig = {
  id: string
  supplierName: string
  /** 路由编码原文；多个可用空格/换行/中英文逗号分隔，解析见 parseFleetRouteCodes */
  routeCode: string
  webhookUrl: string
  signingSecret?: string
  /** 供应商专属推送文案；空则用 Tab 顶栏「推送内容」 */
  pushContent: string
}

export type FleetScanRow = {
  routeCode: string
  postcode: string
  city: string
  orderKey: string
  sourceSheet?: string
  sourceRowNumber?: number
}

export type FleetCityBucket = { city: string; count: number }
export type FleetPostcodeBucket = { postcode: string; cities: FleetCityBucket[]; total: number }
export type FleetRouteBucket = { routeCode: string; postcodes: FleetPostcodeBucket[]; total: number }
