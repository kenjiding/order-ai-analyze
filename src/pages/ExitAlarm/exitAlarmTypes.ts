import type { RegionOption } from '../../api/authApi'

// 1=周一, 2=周二, ..., 6=周六, 7=周日
export type WeekdayNum = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** 州/区域静态列表，对齐 server/src/regions/registry.ts 的 AU_REGIONS（不走 /api/admin 接口，避免要求超管权限） */
export const AU_REGIONS: RegionOption[] = [
  { code: 'NSW', name: '新南威尔士州', nameEn: 'New South Wales', sortOrder: 10 },
  { code: 'VIC', name: '维多利亚州', nameEn: 'Victoria', sortOrder: 20 },
  { code: 'QLD', name: '昆士兰州', nameEn: 'Queensland', sortOrder: 30 },
  { code: 'SA', name: '南澳大利亚州', nameEn: 'South Australia', sortOrder: 40 },
  { code: 'WA', name: '西澳大利亚州', nameEn: 'Western Australia', sortOrder: 50 },
  { code: 'TAS', name: '塔斯马尼亚州', nameEn: 'Tasmania', sortOrder: 60 },
  { code: 'ACT', name: '首都领地', nameEn: 'Australian Capital Territory', sortOrder: 70 },
  { code: 'NT', name: '北领地', nameEn: 'Northern Territory', sortOrder: 80 },
  { code: 'NZ', name: '新西兰', nameEn: 'New Zealand', sortOrder: 90 },
]

export type PushTimeSlot = {
  id: string
  time: string // "HH:mm" 格式，阿德莱德时区
}

export type ExitAlarmScheduleDraft = {
  weekdays: WeekdayNum[]
  pushTimes: PushTimeSlot[]
  isEnabled: boolean
  stationCode: string
  pushConfigIds: string[]
  /** 是否 @ 供应商配置花名册第 1 位外部联系人 */
  mentionEnabled: boolean
  /** 是否推送白名单路由码的 11 点前出仓数据 */
  routeCodeWhitelistPushEnabled: boolean
  /** 「立刻推送」使用的到件扫描日期 YYYY-MM-DD，可多选（多日数据合并统计）；为空时按自动计算的最近工作日兜底，不影响自动定时推送 */
  arrivalScanDates: string[]
  /** 滞留清货价：每件清货补贴（美元）；填写后飞书卡片展示「未出仓件数 × 单价」的清货费用，为空则不展示 */
  clearancePrice: number | null
  /** 重要提醒：填写后原样追加在推送卡片末尾；同时勾选「@ 相关人员」时 @ 人拼在提醒后面 */
  importantNotice: string | null
}

export type ExitAlarmSchedule = ExitAlarmScheduleDraft & {
  id: string
  updatedAt: string
  /** 服务端是否已具备定时拉数所需的 iMile token */
  hasImileToken: boolean
  /** 该配置所属账号的州/区域（只读，随账号信息变化），决定 pushTimes/weekdays 按哪个时区判断；未设置兜底阿德莱德 */
  regionCode: string | null
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
