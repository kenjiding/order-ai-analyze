export { AU_REGIONS } from '../ExitAlarm/exitAlarmTypes'
import type { PushTimeSlot, WeekdayNum } from '../ExitAlarm/exitAlarmTypes'

export type DispatchAlarmScheduleDraft = {
  weekdays: WeekdayNum[]
  pushTimes: PushTimeSlot[]
  isEnabled: boolean
  stationCode: string
  /** 24H 派签率预警阈值（百分比整数）：低于该值的供应商在推送卡片中标红 */
  alertThresholdPct: number
  pushConfigIds: string[]
  /** 「立刻推送」使用的到件扫描日期 YYYY-MM-DD；为空时按自动计算的最近工作日兜底，不影响自动定时推送 */
  arrivalScanDate: string | null
  /** 是否 @ 供应商配置花名册第 1 位外部联系人 */
  mentionEnabled: boolean
  /** 是否在 24H 派签落地页展示「司机地图」组件 */
  showDriverMap: boolean
}

export type DispatchAlarmSchedule = DispatchAlarmScheduleDraft & {
  id: string
  updatedAt: string
  /** 服务端是否已具备定时拉数所需的 iMile token */
  hasImileToken: boolean
  /** 该配置所属账号的州/区域（只读，随账号信息变化），决定 pushTimes/weekdays 按哪个时区判断；未设置兜底阿德莱德 */
  regionCode: string | null
}
