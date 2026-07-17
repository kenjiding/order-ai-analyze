import { formatDepartmentIds, parseDepartmentIds } from './zktDepartmentTree'

export type ZktAttendanceSettings = {
  username: string
  password: string
  /** ZKT departments 参数，多选时为逗号分隔 ID，如 16,27；允许为空表示未选择 */
  departmentId: string
}

export const DEFAULT_ZKT_ATTENDANCE_SETTINGS: ZktAttendanceSettings = {
  username: '',
  password: '',
  departmentId: '',
}

export function normalizeZktAttendanceSettings(
  raw: Partial<ZktAttendanceSettings> | null | undefined,
): ZktAttendanceSettings {
  return {
    username: String(raw?.username ?? '').trim(),
    password: String(raw?.password ?? ''),
    departmentId: formatDepartmentIds(parseDepartmentIds(String(raw?.departmentId ?? ''))),
  }
}

export function toZktAttendanceInput(settings: ZktAttendanceSettings) {
  return normalizeZktAttendanceSettings(settings)
}
