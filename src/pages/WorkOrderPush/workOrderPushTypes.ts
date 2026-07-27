export type { PushTimeSlot, WeekdayNum } from '../ExitAlarm/exitAlarmTypes'

import type { PushTimeSlot, WeekdayNum } from '../ExitAlarm/exitAlarmTypes'

export type WorkOrderPushScheduleDraft = {
  weekdays: WeekdayNum[]
  /** 推送星期内每天检查的推送时间点列表，格式 HH:mm，可配置多个 */
  pushTimes: PushTimeSlot[]
  isEnabled: boolean
  /** 定时查询使用的处理站点编码，只检查该站点的未处理工单 */
  stationCode: string
  pushConfigIds: string[]
}

export type WorkOrderPushSchedule = WorkOrderPushScheduleDraft & {
  id: string
  updatedAt: string
  /** 服务端是否已具备定时拉数所需的 iMile token */
  hasImileToken: boolean
  /** 该配置所属账号的州/区域（只读），决定推送时间按哪个时区判断 */
  regionCode: string | null
}
