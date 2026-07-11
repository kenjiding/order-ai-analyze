import type { PushTimeSlot, WeekdayNum } from './exitAlarmTypes'

export type DispatchAlarmScheduleDraft = {
  weekdays: WeekdayNum[]
  pushTimes: PushTimeSlot[]
  isEnabled: boolean
  stationCode: string
  /** 24H 派签率预警阈值（百分比整数）：低于该值的供应商在推送卡片中标红 */
  alertThresholdPct: number
}

export type DispatchAlarmSchedule = DispatchAlarmScheduleDraft & {
  id: string
  pushConfigIds: string[]
  updatedAt: string
  /** 服务端是否已具备定时拉数所需的 iMile token */
  hasImileToken: boolean
  /** 该配置所属账号的州/区域（只读，随账号信息变化），决定 pushTimes/weekdays 按哪个时区判断；未设置兜底阿德莱德 */
  regionCode: string | null
}

export type DispatchAlarmPushNowResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
  stationCode: string
  date: string
}
