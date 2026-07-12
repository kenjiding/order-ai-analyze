export type DriverMapConfig = {
  enabledVendors: Array<{ vendorCode: string; vendorName: string; stationCode: string }>
  hasBrowserMapsKey: boolean
}

export type DriverMapPointStatus = 'completed' | 'problem' | 'pending'

export type DriverMapPoint = {
  waybillNo: string
  status: DriverMapPointStatus
  lat: number
  lng: number
  time: string
  address: string
  /** 问题件原因 */
  problemReason?: string
}

export type DriverMapDriver = {
  courierCode: string
  courierName: string
  points: DriverMapPoint[]
  currentPosition: { lat: number; lng: number } | null
}

export type DriverMapPointsResponse = {
  dataDate: string
  stationCode: string
  drivers: DriverMapDriver[]
  pendingCount: number
  completedCount: number
  problemCount: number
  geocodedCount: number
  totalCount: number
}

export type DriverMapRefreshResponse = {
  dataDate: string
  stationCode: string
  indexCount: number
  fetchedCount: number
  skippedCount: number
  geocodedUpdated: number
  points: DriverMapPointsResponse
}
