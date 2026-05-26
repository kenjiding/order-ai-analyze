import type { RateSettings } from '../../payroll/wageRateCalculation'

async function wageIdb() {
  return import('./wageSalaryRepository.idb')
}

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

export async function loadRateSettingsFromStorage(defaults: RateSettings): Promise<RateSettings> {
  return (await wageIdb()).loadRateSettingsFromIdb(defaults)
}

export async function saveRateSettingsToStorage(settings: RateSettings): Promise<void> {
  return (await wageIdb()).saveRateSettingsToIdb(settings)
}

export async function clearRateSettingsStorage(): Promise<void> {
  return (await wageIdb()).clearRateSettingsIdb()
}

export async function loadActualWorkerRateSettingsFromStorage(defaults: RateSettings): Promise<RateSettings> {
  return (await wageIdb()).loadActualWorkerRateSettingsFromIdb(defaults)
}

export async function saveActualWorkerRateSettingsToStorage(settings: RateSettings): Promise<void> {
  return (await wageIdb()).saveActualWorkerRateSettingsToIdb(settings)
}

export async function clearActualWorkerRateSettingsStorage(): Promise<void> {
  return (await wageIdb()).clearActualWorkerRateSettingsIdb()
}

export async function loadEmployeesFromStorage(): Promise<StoredEmployee[]> {
  return (await wageIdb()).loadEmployeesFromIdb()
}

export async function saveEmployeesToStorage(employees: StoredEmployee[]): Promise<void> {
  return (await wageIdb()).saveEmployeesToIdb(employees)
}
