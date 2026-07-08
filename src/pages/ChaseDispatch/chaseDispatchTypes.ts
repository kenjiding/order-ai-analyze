export type { WeekdayNum, PushTimeSlot } from '../ExitAlarm/exitAlarmTypes'
export { AU_REGIONS } from '../ExitAlarm/exitAlarmTypes'

import type { PushTimeSlot, WeekdayNum } from '../ExitAlarm/exitAlarmTypes'

/** 滞留时间区间，值与 server/src/imile/stagnantWaybills.ts 的 StagnationBucket 保持一致 */
export type StagnationBucket = '0-1' | '1-2' | '2-3' | '3-4' | '4-5' | '5-6' | '6-7' | '7+'

export const STAGNATION_BUCKET_OPTIONS: { value: StagnationBucket; label: string }[] = [
  { value: '0-1', label: '0~1' },
  { value: '1-2', label: '1~2' },
  { value: '2-3', label: '2~3' },
  { value: '3-4', label: '3~4' },
  { value: '4-5', label: '4~5' },
  { value: '5-6', label: '5~6' },
  { value: '6-7', label: '6~7' },
  { value: '7+', label: '≥7' },
]

export type ChaseDispatchScheduleDraft = {
  weekdays: WeekdayNum[]
  pushTimes: PushTimeSlot[]
  stagnationBuckets: StagnationBucket[]
  isEnabled: boolean
  stationCode: string
}

export type ChaseDispatchSchedule = ChaseDispatchScheduleDraft & {
  id: string
  pushConfigIds: string[]
  updatedAt: string
  /** 服务端是否已具备定时拉数所需的 iMile token */
  hasImileToken: boolean
  /** 该配置所属账号的州/区域（只读），决定 pushTimes/weekdays/滞留时间基准按哪个时区判断 */
  regionCode: string | null
}
