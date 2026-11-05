import type { SupplierMentionContact } from '../../shared/supplierPushConfig'

// 1=周一, 2=周二, ..., 6=周六, 7=周日
export type WeekdayNum = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type PushTimeSlot = {
  id: string
  time: string // "HH:mm" 格式（按账号所属州本地时间）
}

export type RegionOption = { value: string; label: string }

export type StationEntry = { code: string; name: string }

export type RegionClearancePushScheduleDraft = {
  regionCode: string
  regionName: string
  stationCodes: StationEntry[]
  weekdays: WeekdayNum[]
  pushTimes: PushTimeSlot[]
  isEnabled: boolean
  chatId: string
  mentionOpenIds: SupplierMentionContact[]
}

export type RegionClearancePushSchedule = RegionClearancePushScheduleDraft & {
  id: string
  updatedAt: string
  hasImileToken: boolean
  regionAccountCode: string | null
}
