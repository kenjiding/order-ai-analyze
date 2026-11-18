import type { RateSettings } from '../../payroll/wageRateCalculation'

export const ROLES = ['level26', 'level28', 'level30'] as const

export type WageRole = (typeof ROLES)[number]

export function roleBadgeClassName(role: string): string {
  switch (role) {
    case 'level26':
      return 'bg-blue-100 text-blue-800'
    case 'level28':
      return 'bg-cyan-100 text-cyan-800'
    case 'level30':
      return 'bg-purple-100 text-purple-800'
    default:
      return 'bg-slate-100 text-slate-800'
  }
}

export const DEFAULT_RATE_SETTINGS: RateSettings = {
  level26: { workday: 34.44, sortingWeekend: 43.05, publicHoliday: 86.1 },
  level28: { workday: 34.44, sortingWeekend: 43.05, publicHoliday: 86.1 },
  level30: { workday: 36.9, sortingWeekend: 46.125, publicHoliday: 92.25 },
}

/** 与 DEFAULT_RATE_SETTINGS 结构相同；默认数值一致，用户可改为供应商实际发给各档位的时薪。 */
export const DEFAULT_ACTUAL_WORKER_RATE_SETTINGS: RateSettings = {
  level26: { workday: 34.44, sortingWeekend: 43.05, publicHoliday: 86.1 },
  level28: { workday: 34.44, sortingWeekend: 43.05, publicHoliday: 86.1 },
  level30: { workday: 36.9, sortingWeekend: 46.125, publicHoliday: 92.25 },
}
