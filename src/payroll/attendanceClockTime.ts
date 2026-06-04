import { format, isValid } from 'date-fns'
import { parseDate } from './attendanceDate'

/**
 * 考勤表「实际签到/签退」时刻比业务悉尼时间快 30 分钟；
 * 解析后统一回拨，以便与到件扫描、包裹分配等口径对齐。
 */
export const ATTENDANCE_CLOCK_TIME_OFFSET_MINUTES = -30

export function adjustAttendanceClockTime(value: Date | null | undefined): Date | null {
  if (!value || Number.isNaN(value.getTime())) return null
  return new Date(value.getTime() + ATTENDANCE_CLOCK_TIME_OFFSET_MINUTES * 60_000)
}

function parseClockTextToDate(raw: string, dateAnchor: Date | null): Date | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const asFull = parseDate(trimmed)
  if (asFull) return asFull

  if (!dateAnchor) return null

  const timeOnly = trimmed.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (timeOnly) {
    const [, h, m, s = '0'] = timeOnly
    const out = new Date(dateAnchor)
    out.setHours(Number(h), Number(m), Number(s), 0)
    return out
  }

  return null
}

function formatAdjustedClockText(raw: string, adjusted: Date): string {
  const trimmed = raw.trim()
  const timeOnly =
    /^\d{1,2}:\d{1,2}(?::\d{1,2})?$/.test(trimmed) &&
    !trimmed.includes('-') &&
    !trimmed.includes('/') &&
    !trimmed.includes('T')
  if (timeOnly) {
    return format(adjusted, 'HH:mm:ss')
  }
  return format(adjusted, 'yyyy-MM-dd HH:mm:ss')
}

/** 考勤表原始打卡文本 → 回拨 offset 后的展示/存储文本 */
export function adjustAttendanceClockTimeText(
  raw: string,
  dateAnchor?: string | Date | null,
): string {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return ''

  const anchor =
    dateAnchor == null
      ? null
      : dateAnchor instanceof Date
        ? dateAnchor
        : parseDate(dateAnchor)
  const parsed = parseClockTextToDate(trimmed, anchor)
  if (!parsed) return trimmed

  const adjusted = adjustAttendanceClockTime(parsed)
  if (!adjusted || !isValid(adjusted)) return trimmed

  return formatAdjustedClockText(trimmed, adjusted)
}
