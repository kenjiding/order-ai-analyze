import dayjs from 'dayjs'
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

export const ATTENDANCE_PROCESS_CATEGORIES = [
  { code: 'coarse_sort', label: '粗分' },
  { code: 'fine_sort', label: '细分' },
  { code: 'forklift', label: '叉车' },
  { code: 'front_desk', label: '前台' },
  { code: 'loading', label: '上料' },
  { code: 'supply', label: '供货' },
  { code: 'grid_slot', label: '格口' },
] as const

export const ATTENDANCE_SHIFTS = [
  { code: 'morning', label: '早班' },
  { code: 'noon', label: '午班' },
  { code: 'evening', label: '晚班' },
] as const

export type AttendanceProcessCategoryCode = (typeof ATTENDANCE_PROCESS_CATEGORIES)[number]['code']
export type AttendanceShiftCode = (typeof ATTENDANCE_SHIFTS)[number]['code']

export function attendanceProcessCategoryLabel(code: string): string {
  return ATTENDANCE_PROCESS_CATEGORIES.find((c) => c.code === code)?.label ?? code
}

export function attendanceShiftLabel(code: string): string {
  return ATTENDANCE_SHIFTS.find((s) => s.code === code)?.label ?? code
}

/** 工序级联选择器 options：一级=工序类别，二级=班次，叶子 label 拼接为「粗分早班」等复合展示名 */
export const ATTENDANCE_PROCESS_CASCADER_OPTIONS = ATTENDANCE_PROCESS_CATEGORIES.map((category) => ({
  value: category.code,
  label: category.label,
  children: ATTENDANCE_SHIFTS.map((shift) => ({
    value: shift.code,
    label: `${category.label}${shift.label}`,
  })),
}))

/** react-vant Cascader 用字段名为 text（而非 antd 的 label），单独维护一份同源 options */
export const ATTENDANCE_PROCESS_VANT_CASCADER_OPTIONS = ATTENDANCE_PROCESS_CATEGORIES.map((category) => ({
  value: category.code,
  text: category.label,
  children: ATTENDANCE_SHIFTS.map((shift) => ({
    value: shift.code,
    text: `${category.label}${shift.label}`,
  })),
}))

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
