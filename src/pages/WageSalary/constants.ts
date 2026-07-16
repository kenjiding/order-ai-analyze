import type { RateSettings } from '../../payroll/wageRateCalculation'

export const ROLE_MAP: Record<string, string> = {
  worker: '普通小工',
  seniorWorker: '高级小工',
  forklift: '叉车',
  receptionist: '前台',
}

export const ROLES = ['worker', 'seniorWorker', 'forklift', 'receptionist'] as const

export function roleBadgeClassName(role: string): string {
  switch (role) {
    case 'worker':
      return 'bg-blue-100 text-blue-800'
    case 'seniorWorker':
      return 'bg-cyan-100 text-cyan-800'
    case 'forklift':
      return 'bg-purple-100 text-purple-800'
    case 'receptionist':
      return 'bg-green-100 text-green-800'
    default:
      return 'bg-slate-100 text-slate-800'
  }
}

export const DEFAULT_RATE_SETTINGS: RateSettings = {
  worker: { workday: 34.44, sortingWeekend: 43.05, publicHoliday: 86.1 },
  seniorWorker: { workday: 34.44, sortingWeekend: 43.05, publicHoliday: 86.1 },
  forklift: { workday: 36.9, sortingWeekend: 46.125, publicHoliday: 92.25 },
  receptionist: { workday: 36.9, sortingWeekend: 46.125, publicHoliday: 92.25 },
}

/** 与 DEFAULT_RATE_SETTINGS 结构相同；默认数值一致，用户可改为供应商实际发给各角色的时薪。 */
export const DEFAULT_ACTUAL_WORKER_RATE_SETTINGS: RateSettings = {
  worker: { workday: 34.44, sortingWeekend: 43.05, publicHoliday: 86.1 },
  seniorWorker: { workday: 34.44, sortingWeekend: 43.05, publicHoliday: 86.1 },
  forklift: { workday: 36.9, sortingWeekend: 46.125, publicHoliday: 92.25 },
  receptionist: { workday: 36.9, sortingWeekend: 46.125, publicHoliday: 92.25 },
}
