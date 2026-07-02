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
 * 求给定 UTC 时刻在指定时区的本地偏移量（毫秒）。
 * 偏移 = 本地时间（视作 UTC）- 实际 UTC 时间。
 */
function getOffsetMs(utcDate: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(utcDate)
  const g = (t: string) => {
    const v = parseInt(parts.find((p) => p.type === t)?.value ?? '0')
    return t === 'hour' && v === 24 ? 0 : v
  }
  const localMs = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  return localMs - utcDate.getTime()
}

/**
 * 把本地时间字符串（"YYYY-MM-DD HH:mm:ss"，无时区信息）解析为该时区的 UTC 毫秒数。
 * 原理：以本地时间作为 UTC 探针，计算出实际偏移后修正。
 */
function parseLocalStrMs(str: string, tz: string): number {
  const [datePart, timePart = '00:00:00'] = str.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [h = 0, m = 0, s = 0] = timePart.split(':').map(Number)
  const probeMs = Date.UTC(year, month - 1, day, h, m, s)
  return probeMs - getOffsetMs(new Date(probeMs), tz)
}

/**
 * 把 iMile 返回的时间字符串（墨尔本本地时间）解析为 UTC 毫秒数。
 */
export function iMileStrToMs(str: string): number {
  return parseLocalStrMs(str, IMILE_TZ)
}

/**
 * 以 iMile 时间字符串（墨尔本时间）的日期为基准，求次日在 targetTz 的
 * hour:minute 时刻对应的 UTC 毫秒数。
 *
 * 示例：
 *   nextDayHourMs('2024-06-25 22:00:00', AUS_TZ.Adelaide, 11)
 *   → 阿德莱德 2024-06-26 11:00 ACST 对应的 UTC 毫秒
 */
export function nextDayHourMs(
  iMileStr: string,
  targetTz: AusTz,
  hour: number,
  minute = 0,
): number {
  // 把 iMile 字符串的日期（墨尔本本地日期）当天中午解析为 UTC，避免跨日边界歧义
  const datePart = iMileStr.slice(0, 10)
  const thisDayNoonMs = parseLocalStrMs(`${datePart} 12:00:00`, IMILE_TZ)

  // 加 24h 得到次日中午的 UTC 时刻
  const nextDayNoonMs = thisDayNoonMs + 24 * 60 * 60 * 1000

  // 提取次日在目标时区的日期（en-CA locale 输出 YYYY-MM-DD）
  const nextDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: targetTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nextDayNoonMs))

  // 把次日在目标时区的 hour:minute 转为 UTC ms
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return parseLocalStrMs(`${nextDateStr} ${hh}:${mm}:00`, targetTz)
}
