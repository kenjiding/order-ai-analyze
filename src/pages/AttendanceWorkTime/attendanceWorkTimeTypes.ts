import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import { AU_REGIONS } from '../ExitAlarm/exitAlarmTypes'

export { AU_REGIONS }

/** 由开始/结束时间计算十进制总时长（小时，保留 2 位）；无结束时间或非法区间返回 null */
export function calcAttendanceDurationHours(startTime: string, endTime: string | null): number | null {
  if (!endTime) return null
  const start = dayjs(startTime)
  const end = dayjs(endTime)
  if (!start.isValid() || !end.isValid()) return null
  const hours = end.diff(start, 'millisecond') / 3_600_000
  if (!Number.isFinite(hours) || hours <= 0) return null
  return Math.round(hours * 100) / 100
}

export function formatAttendanceDurationHours(startTime: string, endTime: string | null): string {
  const hours = calcAttendanceDurationHours(startTime, endTime)
  return hours == null ? '—' : hours.toFixed(2)
}

export const ATTENDANCE_PROCESS_CATEGORY_CODES = [
  'coarse_sort',
  'fine_sort',
  'forklift',
  'front_desk',
  'loading',
  'supply',
  'grid_slot',
] as const

export const ATTENDANCE_SHIFT_CODES = ['morning', 'noon', 'evening'] as const

export type AttendanceProcessCategoryCode = (typeof ATTENDANCE_PROCESS_CATEGORY_CODES)[number]
export type AttendanceShiftCode = (typeof ATTENDANCE_SHIFT_CODES)[number]

export function attendanceProcessCategoryLabel(code: string, t: TFunction<'attendanceWorkTime'>): string {
  return t(`processCategory.${code as AttendanceProcessCategoryCode}`, { defaultValue: code })
}

export function attendanceShiftLabel(code: string, t: TFunction<'attendanceWorkTime'>): string {
  return t(`shift.${code as AttendanceShiftCode}`, { defaultValue: code })
}

/** 工序级联选择器 options：一级=工序类别，二级=班次，叶子 label 拼接为「粗分早班」等复合展示名 */
export function buildAttendanceProcessCascaderOptions(t: TFunction<'attendanceWorkTime'>) {
  return ATTENDANCE_PROCESS_CATEGORY_CODES.map((categoryCode) => {
    const categoryLabel = attendanceProcessCategoryLabel(categoryCode, t)
    return {
      value: categoryCode,
      label: categoryLabel,
      children: ATTENDANCE_SHIFT_CODES.map((shiftCode) => ({
        value: shiftCode,
        label: `${categoryLabel}${attendanceShiftLabel(shiftCode, t)}`,
      })),
    }
  })
}

/** react-vant Cascader 用字段名为 text（而非 antd 的 label），单独维护一份同源 options */
export function buildAttendanceProcessVantCascaderOptions(t: TFunction<'attendanceWorkTime'>) {
  return ATTENDANCE_PROCESS_CATEGORY_CODES.map((categoryCode) => {
    const categoryLabel = attendanceProcessCategoryLabel(categoryCode, t)
    return {
      value: categoryCode,
      text: categoryLabel,
      children: ATTENDANCE_SHIFT_CODES.map((shiftCode) => ({
        value: shiftCode,
        text: `${categoryLabel}${attendanceShiftLabel(shiftCode, t)}`,
      })),
    }
  })
}

export type AttendanceWorkRecord = {
  id: string
  regionCode: string
  workerId: string
  workerName: string
  processCategory: string
  shift: string
  zoneCode: string | null
  startTime: string
  endTime: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type AttendanceWorkRecordDraft = {
  regionCode?: string
  workerName: string
  processCategory: string
  shift: string
  zoneCode: string | null
  startTime: string
  endTime: string | null
  notes: string | null
}

export type AttendanceWorkerSuggestion = {
  id: string
  name: string
  regionCode: string
}
