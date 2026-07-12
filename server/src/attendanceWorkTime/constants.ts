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

const PROCESS_CATEGORY_CODES = new Set<string>(ATTENDANCE_PROCESS_CATEGORIES.map((c) => c.code))
const SHIFT_CODES = new Set<string>(ATTENDANCE_SHIFTS.map((s) => s.code))

export function isValidAttendanceProcessCategory(code: string): code is AttendanceProcessCategoryCode {
  return PROCESS_CATEGORY_CODES.has(code)
}

export function isValidAttendanceShift(code: string): code is AttendanceShiftCode {
  return SHIFT_CODES.has(code)
}
