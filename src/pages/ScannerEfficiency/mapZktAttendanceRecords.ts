import type { ParsedAttendanceRow } from './aggregates'
import { formatDateKey, parseDurationToHours } from './formatAndParse'
import { adjustAttendanceClockTime } from '../../payroll/attendanceClockTime'

function normalizePositionTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
}

function isFrontDeskPosition(positionTitle: string, positionCode: string): boolean {
  const title = normalizePositionTitle(positionTitle)
  if (title.includes('level 2-30') || title.includes('level 3-30') || title.includes('level-30')) {
    return true
  }
  const codeDigits = String(positionCode || '').match(/\d+/)?.[0] ?? ''
  return codeDigits === '30'
}

function isSystemAccount(value: string): boolean {
  return value.trim().toLowerCase() === 'system'
}

function readText(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (value == null) return ''
  return String(value).trim()
}

function combineDateAndClockTime(date: Date, value: string): Date | null {
  if (!value) return null
  const base = new Date(date)
  const timeOnly = value.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (!timeOnly) return null
  const [, h, m, s = '0'] = timeOnly
  const hours = Number(h)
  const minutes = Number(m)
  const seconds = Number(s)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null
  const out = new Date(base)
  out.setHours(hours, minutes, seconds, 0)
  return out
}

function parseAttendanceDate(raw: string): Date | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [, y, m, d] = match
  const dt = new Date(Number(y), Number(m) - 1, Number(d))
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(m) - 1 || dt.getDate() !== Number(d)) {
    return null
  }
  return dt
}

/** ZKT `worked_hrs` 与考勤表「工作时长」列一一对应 */
function parseWorkedHrs(record: Record<string, unknown>): number | null {
  return parseDurationToHours(record.worked_hrs)
}

export function mapZktTimeCardRecordsToParsedAttendanceRows(
  records: unknown[],
  sourceLabel: string,
  dateRange?: { startDate: string; endDate: string },
): { rows: ParsedAttendanceRow[]; droppedRows: number } {
  const rows: ParsedAttendanceRow[] = []
  let droppedRows = 0

  records.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      droppedRows += 1
      return
    }
    const record = item as Record<string, unknown>
    const date = parseAttendanceDate(readText(record, 'att_date') || readText(record, 'att_date_normal'))
    const hours = parseWorkedHrs(record)
    if (!date || hours == null || !Number.isFinite(hours) || hours <= 0) {
      droppedRows += 1
      return
    }

    const empCode = readText(record, 'emp_code')
    const nickName = readText(record, 'nick_name')
    const firstName = readText(record, 'first_name')
    const lastName = readText(record, 'last_name')
    const nameFull = [firstName, lastName].filter(Boolean).join(' ').trim()
    const sorterKey = nickName || empCode || nameFull
    const positionTitle = readText(record, 'position_name')
    const positionCode = readText(record, 'position_code')
    const isFrontDesk = isFrontDeskPosition(positionTitle, positionCode)

    if (!sorterKey) {
      droppedRows += 1
      return
    }

    if ([sorterKey, nickName, nameFull, empCode].some(isSystemAccount)) {
      droppedRows += 1
      return
    }

    const clockInTime = adjustAttendanceClockTime(
      combineDateAndClockTime(date, readText(record, 'clock_in')),
    )
    const clockOutTime = adjustAttendanceClockTime(
      combineDateAndClockTime(date, readText(record, 'clock_out')),
    )

    rows.push({
      date: formatDateKey(date),
      sorterKey,
      sorterName: nickName || nameFull || empCode,
      nameNick: nickName,
      nameFull,
      hours,
      clockInTime,
      clockOutTime,
      positionTitle: positionTitle || undefined,
      positionCode: positionCode || undefined,
      isFrontDesk,
      isSorterWorker: !isFrontDesk,
      workday: readText(record, 'holiday_sign') || undefined,
      surname: lastName || undefined,
      sourceFileName: sourceLabel,
      sourceSheetName: '',
      sourceRowNumber: index + 1,
    })
  })

  if (!dateRange) {
    return { rows, droppedRows }
  }

  const { startDate, endDate } = dateRange
  const filteredRows: ParsedAttendanceRow[] = []
  for (const row of rows) {
    if (row.date < startDate || row.date > endDate) {
      droppedRows += 1
      continue
    }
    filteredRows.push(row)
  }

  return { rows: filteredRows, droppedRows }
}
