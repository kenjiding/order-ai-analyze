// 1=周一, 2=周二, ..., 6=周六, 7=周日
export type WeekdayNum = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type PushTimeSlot = {
  id: string
  time: string // "HH:mm" 格式，阿德莱德时区
}

export type ExitAlarmScheduleDraft = {
  weekdays: WeekdayNum[]
  pushTimes: PushTimeSlot[]
  isEnabled: boolean
  stationCode: string
}

export type ExitAlarmSchedule = ExitAlarmScheduleDraft & {
  id: string
  updatedAt: string
  /** 服务端是否已具备定时拉数所需的 iMile token */
  hasImileToken: boolean
}

// iMile searchWaybill 接口返回的单条数据
export type WaybillSearchItem = {
  deliveryTime?: string | null
  courierVendor?: string
  courier?: string
  courierCode?: string
  courierVendorCode?: string
  consigneeRouteCode?: string
  lastScanStationCode?: string
  lastScanStationName?: string
  [key: string]: unknown
}
