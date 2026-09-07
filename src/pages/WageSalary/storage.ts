import { getUserPreference, putUserPreference } from '../../api/userPreferencesApi'
import { i18n } from '../../i18n'
import type { RateSettings } from '../../payroll/wageRateCalculation'

async function wageIdb() {
  return import('./wageSalaryRepository.idb')
}

/** 绑定登录账号，存服务端 user_preferences 表 */
export const WAGE_RATE_SETTINGS_PREF_KEY = 'wage-rate-settings'
export const WAGE_ACTUAL_WORKER_RATE_SETTINGS_PREF_KEY = 'wage-actual-worker-rate-settings'

export type StoredEmployee = {
  _id: string
  employeeId: string
  name?: string
  surname?: string
  nickname?: string
  department?: string
  role: string
  createdAt: string
}

export function mergeRateSettings(saved: Partial<RateSettings> | null, defaults: RateSettings): RateSettings {
  const out: RateSettings = JSON.parse(JSON.stringify(defaults))
  if (!saved) return out
  for (const role of Object.keys(defaults)) {
    if (saved[role]) {
      out[role] = { ...defaults[role], ...saved[role] }
    }
  }
  return out
}

async function loadRateSettingsFromServer(
  prefKey: string,
  defaults: RateSettings,
): Promise<RateSettings> {
  const result = await getUserPreference<Partial<RateSettings>>(prefKey)
  if (!result.ok || result.data.value === null) {
    return defaults
  }
  return mergeRateSettings(result.data.value, defaults)
}

async function saveRateSettingsToServer(prefKey: string, settings: RateSettings): Promise<void> {
  const result = await putUserPreference(prefKey, settings)
  if (!result.ok) {
    throw new Error(result.error || i18n.t('storage.saveRateSettingsFailed', { ns: 'wageSalary' }))
  }
}

export async function loadRateSettingsFromStorage(defaults: RateSettings): Promise<RateSettings> {
  return loadRateSettingsFromServer(WAGE_RATE_SETTINGS_PREF_KEY, defaults)
}

export async function saveRateSettingsToStorage(settings: RateSettings): Promise<void> {
  await saveRateSettingsToServer(WAGE_RATE_SETTINGS_PREF_KEY, settings)
}

export async function loadActualWorkerRateSettingsFromStorage(defaults: RateSettings): Promise<RateSettings> {
  return loadRateSettingsFromServer(WAGE_ACTUAL_WORKER_RATE_SETTINGS_PREF_KEY, defaults)
}

export async function saveActualWorkerRateSettingsToStorage(settings: RateSettings): Promise<void> {
  await saveRateSettingsToServer(WAGE_ACTUAL_WORKER_RATE_SETTINGS_PREF_KEY, settings)
}

export async function loadEmployeesFromStorage(): Promise<StoredEmployee[]> {
  return (await wageIdb()).loadEmployeesFromIdb()
}

export async function saveEmployeesToStorage(employees: StoredEmployee[]): Promise<void> {
  return (await wageIdb()).saveEmployeesToIdb(employees)
}
