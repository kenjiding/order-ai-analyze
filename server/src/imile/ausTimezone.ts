export const AUS_TZ = {
  Melbourne: 'Australia/Melbourne',
  Adelaide: 'Australia/Adelaide',
  Sydney: 'Australia/Sydney',
  Perth: 'Australia/Perth',
  Brisbane: 'Australia/Brisbane',
  Canberra: 'Australia/ACT',
  Darwin: 'Australia/Darwin',
  Hobart: 'Australia/Hobart',
  Auckland: 'Pacific/Auckland',
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
  NZ: AUS_TZ.Auckland,
}

export function resolveRegionTz(regionCode: string | null | undefined): AusTz {
  if (!regionCode) return AUS_TZ.Adelaide
  return REGION_TZ[regionCode] ?? AUS_TZ.Adelaide
}

const TZ_DISPLAY_NAME: Record<AusTz, string> = Object.fromEntries(
  Object.entries(AUS_TZ).map(([name, tz]) => [tz, name]),
) as Record<AusTz, string>

/** IANA 时区值 → 展示名，用于飞书卡片等 UI 文案，如 'Australia/Melbourne' → 'Melbourne' */
export function tzDisplayName(tz: AusTz): string {
  return TZ_DISPLAY_NAME[tz] ?? tz
}

// Intl.DateTimeFormat 构造开销不小（加载 ICU 时区数据），按时区缓存复用；
// getOffsetMs 是 iMileStrToMs 的热路径（如司机地图按时间排序，单页可达每站上万次调用），
// 不缓存会导致排序耗时被构造开销主导（实测 9000 点排序曾达 6s+，缓存后降到毫秒级）
const OFFSET_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()
function getOffsetFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = OFFSET_FORMATTER_CACHE.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-AU', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    OFFSET_FORMATTER_CACHE.set(tz, fmt)
  }
  return fmt
}

/**
 * 求给定 UTC 时刻在指定时区的本地偏移量（毫秒）。
 * 偏移 = 本地时间（视作 UTC）- 实际 UTC 时间。
 */
function getOffsetMs(utcDate: Date, tz: string): number {
  const parts = getOffsetFormatter(tz).formatToParts(utcDate)
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
 * 指定时区的本地日期时间字符串（"YYYY-MM-DD HH:mm:ss"，无时区信息）→ UTC 毫秒。
 * 供「按本地日历日的某个固定时刻」算阈值/截止时刻的场景使用（如 24H 派签窗口、11 点前出仓阈值）。
 */
export function localDateTimeToMs(localStr: string, tz: AusTz): number {
  return parseLocalStrMs(localStr, tz)
}

/**
 * 把 iMile 返回的时间字符串（墨尔本本地时间）解析为 UTC 毫秒数。
 */
export function iMileStrToMs(str: string): number {
  return parseLocalStrMs(str, IMILE_TZ)
}

/** 某 UTC 时刻在指定时区的星期几：0=周日 … 6=周六（对齐前端 dayjs 的 .day()） */
export function weekdayInTz(utcMs: number, tz: AusTz): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(utcMs))
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
}

/** 某 UTC 时刻在指定时区的本地日期 'YYYY-MM-DD' */
export function localDateInTz(utcMs: number, tz: AusTz): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(utcMs))
}

/** 某 UTC 时刻在指定时区的本地日期时间 'YYYY-MM-DD HH:mm' */
export function localDateTimeInTz(utcMs: number, tz: AusTz): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs))
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`
}

/**
 * 以某 UTC 时刻在 targetTz 的本地日期为基准，加 addDays 天后的 hh:mm:ss（targetTz 本地）对应的 UTC 毫秒。
 * 用中午做加天探针，避开 DST 边界歧义。对齐前端 `deliveryLocal.add(n,'day').hour(h)...valueOf()`。
 */
export function localDatePlusDaysMs(
  utcMs: number,
  tz: AusTz,
  addDays: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const baseDate = localDateInTz(utcMs, tz)
  const baseNoonMs = parseLocalStrMs(`${baseDate} 12:00:00`, tz)
  const shiftedDate = localDateInTz(baseNoonMs + addDays * 24 * 60 * 60 * 1000, tz)
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  const ss = String(second).padStart(2, '0')
  return parseLocalStrMs(`${shiftedDate} ${hh}:${mm}:${ss}`, tz)
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
