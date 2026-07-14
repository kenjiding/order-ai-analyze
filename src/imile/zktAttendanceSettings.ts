import { formatDepartmentIds, parseDepartmentIds } from './zktDepartmentTree'

export type ZktAttendanceSettings = {
  username: string
  password: string
  /** ZKT departments 参数，多选时为逗号分隔 ID，如 16,27 */
  departmentId: string
}

export const DEFAULT_ZKT_ATTENDANCE_SETTINGS: ZktAttendanceSettings = {
  username: '',
  password: '',
  departmentId: '23',
}

type LegacyZktAttendanceSettings = Partial<ZktAttendanceSettings> & {
  baseUrl?: string
}

export function normalizeZktAttendanceSettings(
  raw: LegacyZktAttendanceSettings | null | undefined,
): ZktAttendanceSettings {
  return {
    username: String(raw?.username ?? '').trim(),
    password: String(raw?.password ?? ''),
    departmentId: (() => {
      const normalized = formatDepartmentIds(
        parseDepartmentIds(String(raw?.departmentId ?? DEFAULT_ZKT_ATTENDANCE_SETTINGS.departmentId)),
      )
      return normalized || DEFAULT_ZKT_ATTENDANCE_SETTINGS.departmentId
    })(),
  }
}

export function toZktAttendanceInput(settings: ZktAttendanceSettings) {
  return normalizeZktAttendanceSettings(settings)
}
