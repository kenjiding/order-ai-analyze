export type ZktAttendanceSettings = {
  username: string
  password: string
  /** ZKT departments 参数，如 AUS ADL 对应 23 */
  departmentId: string
}

export const DEFAULT_ZKT_ATTENDANCE_SETTINGS: ZktAttendanceSettings = {
  username: '',
  password: '',
  departmentId: '23',
}

export const ZKT_ATTENDANCE_STORAGE_KEY = 'app_zkt_attendance_v1'

type LegacyZktAttendanceSettings = Partial<ZktAttendanceSettings> & {
  baseUrl?: string
}

export function normalizeZktAttendanceSettings(
  raw: LegacyZktAttendanceSettings | null | undefined,
): ZktAttendanceSettings {
  return {
    username: String(raw?.username ?? '').trim(),
    password: String(raw?.password ?? ''),
    departmentId:
      String(raw?.departmentId ?? DEFAULT_ZKT_ATTENDANCE_SETTINGS.departmentId).trim() ||
      DEFAULT_ZKT_ATTENDANCE_SETTINGS.departmentId,
  }
}

export function readStoredZktAttendanceSettings(): ZktAttendanceSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_ZKT_ATTENDANCE_SETTINGS }
  try {
    const raw = localStorage.getItem(ZKT_ATTENDANCE_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_ZKT_ATTENDANCE_SETTINGS }
    return normalizeZktAttendanceSettings(JSON.parse(raw) as LegacyZktAttendanceSettings)
  } catch {
    return { ...DEFAULT_ZKT_ATTENDANCE_SETTINGS }
  }
}

export function toZktAttendanceInput(settings: ZktAttendanceSettings) {
  return normalizeZktAttendanceSettings(settings)
}
