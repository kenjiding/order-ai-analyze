export type { PushTimeSlot } from '../ExitAlarm/exitAlarmTypes'

import type { PushTimeSlot } from '../ExitAlarm/exitAlarmTypes'

export type WorkOrderPushScheduleDraft = {
  /** 每天检查的推送时间点列表，格式 HH:mm，可配置多个 */
  pushTimes: PushTimeSlot[]
  isEnabled: boolean
}

export type WorkOrderPushSchedule = WorkOrderPushScheduleDraft & {
  id: string
  pushConfigIds: string[]
  updatedAt: string
  /** 服务端是否已具备定时拉数所需的 iMile token */
  hasImileToken: boolean
  /** 该配置所属账号的州/区域（只读），决定推送时间按哪个时区判断 */
  regionCode: string | null
}
