import * as XLSX from 'xlsx'
import { ATTENDANCE_TOTAL_HOURS_COLUMNS, ATTENDANCE_WORK_HOURS_COLUMNS } from './constants'
import { dayjs } from './dayjsSetup'

export const DATE_PARSE_FORMATS = [
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-M-D H:mm:ss',
  'YYYY-MM-DD H:mm:ss',
  'DD/MM/YYYY HH:mm:ss',
  'D/M/YYYY H:mm:ss',
  'DD/MM/YYYY HH:mm',
  'D/M/YYYY HH:mm',
  'DD/MM/YYYY',
  'D/M/YYYY',
  'MM/DD/YYYY HH:mm:ss',
  'M/D/YYYY H:mm:ss',
  'MM/DD/YYYY',
  'M/D/YYYY',
  'YYYY-MM-DD',
  'YYYY年M月D日',
  'YYYY年MM月DD日',
  'YYYY-M-D',
  'YYYY-MM-DDTHH:mm:ss.SSSZ',
  'YYYY-MM-DDTHH:mm:ss',
  'YYYY-MM-DDTHH:mm',
] as const

export const formatNumber = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return '-'
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export const formatInteger = (value: number): string => {
  if (!Number.isFinite(value)) return '-'
  return value.toLocaleString('zh-CN')
}

export const formatDateTime = (date: Date | string | number): string => {
  const d = dayjs(date)
  if (!d.isValid()) return '-'
  return d.format('YYYY-MM-DD HH:mm:ss')
}

export const formatDateKey = (date: Date | string | number): string => {
  const d = dayjs(date)
  if (!d.isValid()) return ''
  return d.format('YYYY-MM-DD')
}

export const normalizeHeader = (value: unknown): string =>
  String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, '')
    .trim()

export const sanitizeText = (value: unknown): string => {
  if (value == null) return ''
  return String(value).trim()
}

export const parseDateValue = (value: unknown): Date | null => {
  if (value == null || value === '') return null

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value
  }

  if (typeof value === 'number' && XLSX.SSF?.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return new Date(
      parsed.y,
      (parsed.m ?? 1) - 1,
      parsed.d ?? 1,
      parsed.H ?? 0,
      parsed.M ?? 0,
      Math.floor(parsed.S ?? 0),
    )
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const withZh = trimmed.replace(/T/g, ' ')
    const strict = dayjs(withZh, [...DATE_PARSE_FORMATS], true)
    if (strict.isValid()) return strict.toDate()

    const norm = withZh
      .replace(/年/g, '-')
      .replace(/月/g, '-')
      .replace(/日/g, '')
      .replace(/\s+/g, ' ')
    const afterNorm = dayjs(norm, [...DATE_PARSE_FORMATS], true)
    if (afterNorm.isValid()) return afterNorm.toDate()

    const loose = dayjs(trimmed)
    if (loose.isValid()) return loose.toDate()
  }

  return null
}

export const parseDurationToHours = (value: unknown): number | null => {
  if (value == null || value === '') return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getHours() + value.getMinutes() / 60 + value.getSeconds() / 3600
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 1) return value * 24
    return value
  }

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const hhmm = trimmed.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (hhmm) {
    const [, h, m, s = '0'] = hhmm
    return Number(h) + Number(m) / 60 + Number(s) / 3600
  }

  const chinese = trimmed.match(/^(\d+(?:\.\d+)?)\s*小时(?:\s*(\d+(?:\.\d+)?)\s*分)?$/)
  if (chinese) {
    const [, h, m = '0'] = chinese
    return Number(h) + Number(m) / 60
  }

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    if (numeric <= 1) return numeric * 24
    return numeric
  }

  return null
}

export const normalizeRow = (rawRow: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {}
  Object.keys(rawRow || {}).forEach((key) => {
    normalized[normalizeHeader(key)] = rawRow[key]
  })
  return normalized
}

export const getValueByCandidates = (row: Record<string, unknown>, candidates: readonly string[]): unknown => {
  for (const key of candidates) {
    const normalizedKey = normalizeHeader(key)
    if (Object.prototype.hasOwnProperty.call(row, normalizedKey)) {
      const value = row[normalizedKey]
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return value
      }
    }
  }
  return null
}

/** 考勤工时：优先「工作时长」，否则「总时长」及其它总工时列名。 */
export const parseAttendanceHoursFromRow = (row: Record<string, unknown>): number | null => {
  const workRaw = getValueByCandidates(row, ATTENDANCE_WORK_HOURS_COLUMNS)
  if (workRaw != null) {
    const workHours = parseDurationToHours(workRaw)
    if (workHours != null && Number.isFinite(workHours)) return workHours
  }
  return parseDurationToHours(getValueByCandidates(row, ATTENDANCE_TOTAL_HOURS_COLUMNS))
}
