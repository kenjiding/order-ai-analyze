export type { WeekdayNum, PushTimeSlot } from '../ExitAlarm/exitAlarmTypes'
export { AU_REGIONS } from '../ExitAlarm/exitAlarmTypes'

import type { PushTimeSlot, WeekdayNum } from '../ExitAlarm/exitAlarmTypes'

/** 滞留时间区间，值与 server/src/imile/stagnantWaybills.ts 的 StagnationBucket 保持一致 */
export type StagnationBucket = '0-1' | '1-2' | '2-3' | '3-4' | '4-5' | '5-6' | '6-7' | '7+'

export const STAGNATION_BUCKET_VALUES: StagnationBucket[] = [
  '0-1',
  '1-2',
  '2-3',
  '3-4',
  '4-5',
  '5-6',
  '6-7',
  '7+',
]

export type ChaseDispatchScheduleDraft = {
  weekdays: WeekdayNum[]
  pushTimes: PushTimeSlot[]
  stagnationBuckets: StagnationBucket[]
  isEnabled: boolean
  stationCode: string
  pushConfigIds: string[]
  /** 是否 @ 供应商配置花名册第 1 位外部联系人 */
  mentionEnabled: boolean
}

export type ChaseDispatchSchedule = ChaseDispatchScheduleDraft & {
  id: string
  updatedAt: string
  /** 服务端是否已具备定时拉数所需的 iMile token */
  hasImileToken: boolean
  /** 该配置所属账号的州/区域（只读），决定 pushTimes/weekdays/滞留时间基准按哪个时区判断 */
  regionCode: string | null
}
