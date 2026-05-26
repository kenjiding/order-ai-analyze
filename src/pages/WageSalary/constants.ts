import type { RateSettings } from '../../payroll/wageRateCalculation'

export const ROLE_MAP: Record<string, string> = {
  worker: '普通小工',
  forklift: '叉车',
  receptionist: '前台',
}

export const ROLES = ['worker', 'forklift', 'receptionist'] as const

export const DEFAULT_RATE_SETTINGS: RateSettings = {
  worker: { workday: 34.44, sortingWeekend: 43.05, publicHoliday: 86.1 },
  forklift: { workday: 36.9, sortingWeekend: 46.125, publicHoliday: 92.25 },
  receptionist: { workday: 36.9, sortingWeekend: 46.125, publicHoliday: 92.25 },
}

/** 与 DEFAULT_RATE_SETTINGS 结构相同；默认数值一致，用户可改为供应商实际发给小工/叉车/前台的时薪。 */
export const DEFAULT_ACTUAL_WORKER_RATE_SETTINGS: RateSettings = {
  worker: { workday: 34.44, sortingWeekend: 43.05, publicHoliday: 86.1 },
  forklift: { workday: 36.9, sortingWeekend: 46.125, publicHoliday: 92.25 },
  receptionist: { workday: 36.9, sortingWeekend: 46.125, publicHoliday: 92.25 },
}
