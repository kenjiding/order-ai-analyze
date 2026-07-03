import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

export const AUS_TZ = {
  Melbourne: 'Australia/Melbourne',
  Adelaide: 'Australia/Adelaide',
  Sydney: 'Australia/Sydney',
  Perth: 'Australia/Perth',
  Brisbane: 'Australia/Brisbane',
  Canberra: 'Australia/ACT',
  Darwin: 'Australia/Darwin',
  Hobart: 'Australia/Hobart',
} as const

export type AusTz = (typeof AUS_TZ)[keyof typeof AUS_TZ]

// iMile API 返回的时间均为墨尔本本地时间
const IMILE_TZ = AUS_TZ.Melbourne

/** 账号「州/区域」代码 → 对应时区。未知/未设置州（如超管）兜底阿德莱德 */
const REGION_TZ: Record<string, AusTz> = {
  NSW: AUS_TZ.Sydney,
  VIC: AUS_TZ.Melbourne,
  QLD: AUS_TZ.Brisbane,
  SA: AUS_TZ.Adelaide,
  WA: AUS_TZ.Perth,
  TAS: AUS_TZ.Hobart,
  ACT: AUS_TZ.Canberra,
  NT: AUS_TZ.Darwin,
}

export function resolveRegionTz(regionCode: string | null | undefined): AusTz {
  if (!regionCode) return AUS_TZ.Adelaide
  return REGION_TZ[regionCode] ?? AUS_TZ.Adelaide
}

/**
 * 把 iMile 返回的时间字符串（墨尔本本地时间，无时区信息）解析为指定时区的 dayjs 对象。
 * 默认转换为阿德莱德时区。
 */
export function fromIMileTime(str: string, inTz: AusTz = AUS_TZ.Adelaide) {
  return dayjs.tz(str, IMILE_TZ).tz(inTz)
}

/**
 * 把 iMile 返回的时间字符串（墨尔本本地时间）解析为 UTC 毫秒数。
 */
export function iMileTimeMs(str: string): number {
  return dayjs.tz(str, IMILE_TZ).valueOf()
}

/**
 * 返回当前时刻在指定时区的 dayjs 对象。默认阿德莱德。
 */
export function nowIn(tz: AusTz = AUS_TZ.Adelaide) {
  return dayjs().tz(tz)
}
