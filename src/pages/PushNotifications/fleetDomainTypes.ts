/** 车队推送页专属领域类型（与全局 supplier catalog 无关） */
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
