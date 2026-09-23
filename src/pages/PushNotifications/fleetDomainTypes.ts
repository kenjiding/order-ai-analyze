/** 车队推送页专属领域类型（与全局 supplier catalog 无关） */
export type FleetScanRow = {
  routeCode: string
  postcode: string
  city: string
  orderKey: string
  /** 商家编码；仅「拉取入站数据」来源必有，Excel 导入若带对应列也会识别 */
  clientCode?: string
  sourceSheet?: string
  sourceRowNumber?: number
}

export type FleetCityBucket = { city: string; count: number }
export type FleetPostcodeBucket = { postcode: string; cities: FleetCityBucket[]; total: number }
export type FleetRouteBucket = {
  routeCode: string
  postcodes: FleetPostcodeBucket[]
  total: number
  /** 命中「优先客户配置」的单量（按 orderKey 去重） */
  priorityTotal: number
}
