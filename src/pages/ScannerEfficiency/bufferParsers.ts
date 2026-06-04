/**
 * 同步解析单个 Excel 缓冲区（供 Web Worker 或主线程兜底调用）。
 * 避免在 React 主线程直接调用 XLSX.read 大文件导致长时间阻塞。
 */
import * as XLSX from 'xlsx'
import { adjustAttendanceClockTime } from '../../payroll/attendanceClockTime'
import {
  ALLOCATION_BOX_COLUMNS,
  ALLOCATION_DRIVER_COLUMNS,
  ALLOCATION_DRIVER_COMPANY_COLUMNS,
  ALLOCATION_DRIVER_NO_COLUMNS,
  ALLOCATION_TIME_COLUMNS,
  ATTENDANCE_CLOCK_IN_COLUMNS,
  ATTENDANCE_CLOCK_OUT_COLUMNS,
  ATTENDANCE_DATE_COLUMNS,
  ATTENDANCE_ID_COLUMNS,
  ATTENDANCE_NAME_COLUMNS,
  ATTENDANCE_POSITION_CODE_COLUMNS,
  ATTENDANCE_POSITION_TITLE_COLUMNS,
  SCANNER_COLUMNS,
  SCAN_TIME_COLUMNS,
  SORTING_REQUIRED_COLUMNS,
  TRACKING_COLUMNS,
} from './constants'
import type { ParsedAllocationRow, ParsedAttendanceRow, ParsedScanRow } from './aggregates'
import {
  formatDateKey,
  getValueByCandidates,
  normalizeRow,
  parseAttendanceHoursFromRow,
  parseDateValue,
  sanitizeText,
} from './formatAndParse'

/** 到件扫描：不纳入货量与效率统计的扫描员标识（trim 后小写比对） */
const EXCLUDED_SCAN_IDENTITIES = new Set(['system', 'adl-shigong8'])

function isExcludedScanIdentity(value: string): boolean {
  return EXCLUDED_SCAN_IDENTITIES.has(value.trim().toLowerCase())
}

function isSystemAccount(value: string): boolean {
  return value.trim().toLowerCase() === 'system'
}

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

function combineDateAndClockTime(date: Date, value: unknown): Date | null {
  if (value == null || value === '') return null

  const base = new Date(date)
  const combine = (hours: number, minutes: number, seconds = 0) => {
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null
    const out = new Date(base)
    out.setHours(hours, minutes, seconds, 0)
    return out
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return combine(value.getHours(), value.getMinutes(), value.getSeconds())
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value < 1) {
      const totalSeconds = Math.round(value * 24 * 60 * 60)
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      return combine(hours, minutes, seconds)
    }
    const parsed = parseDateValue(value)
    return parsed
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    const timeOnly = trimmed.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
    if (timeOnly) {
      const [, h, m, s = '0'] = timeOnly
      return combine(Number(h), Number(m), Number(s))
    }
    return parseDateValue(trimmed)
  }

  return null
}

/** 到件/分拣扫描中上述账号产生的记录，不参与货量与效率统计 */
function isExcludedFromScanStats(scanner: string, sortingScanner: string): boolean {
  return isExcludedScanIdentity(scanner) || isExcludedScanIdentity(sortingScanner)
}

/** 考勤中的系统账号不参与分拣人数、工时与效率统计 */
function isExcludedSystemAttendanceRow({
  sorterKey,
  sorterName,
  nameNick,
  nameFull,
}: {
  sorterKey: string
  sorterName: string
  nameNick: string
  nameFull: string
}): boolean {
  return [sorterKey, sorterName, nameNick, nameFull].some(isSystemAccount)
}

export function parseScanFileBuffer(buffer: ArrayBuffer, fileName: string): {
  rows: ParsedScanRow[]
  droppedRows: number
} {
  const rows: ParsedScanRow[] = []
  let droppedRows = 0

  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true })

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    })

    jsonRows.forEach((rawRow, index) => {
      const row = normalizeRow(rawRow)
      const scanTimeValue = getValueByCandidates(row, SCAN_TIME_COLUMNS)
      const scanTime = parseDateValue(scanTimeValue)
      if (!scanTime) {
        droppedRows += 1
        return
      }

      const trackingNumber = sanitizeText(getValueByCandidates(row, TRACKING_COLUMNS))
      const scanner = sanitizeText(getValueByCandidates(row, SCANNER_COLUMNS))

      const sortingScanTime = parseDateValue(getValueByCandidates(row, [SORTING_REQUIRED_COLUMNS[0]]))
      const sortingTrackingNumber = sanitizeText(getValueByCandidates(row, [SORTING_REQUIRED_COLUMNS[1]]))
      const sortingScanner = sanitizeText(getValueByCandidates(row, [SORTING_REQUIRED_COLUMNS[2]]))
      const sortingEligible = Boolean(sortingScanTime && sortingTrackingNumber && sortingScanner)

      if (isExcludedFromScanStats(scanner, sortingScanner)) {
        droppedRows += 1
        return
      }

      rows.push({
        scanTime,
        trackingNumber,
        scanner,
        sortingScanTime,
        sortingTrackingNumber,
        sortingScanner,
        sortingEligible,
        sourceFileName: fileName,
        sourceSheetName: sheetName,
        sourceRowNumber: index + 2,
      })
    })
  })

  return { rows, droppedRows }
}

export function parseAttendanceFileBuffer(buffer: ArrayBuffer, fileName: string): {
  rows: ParsedAttendanceRow[]
  droppedRows: number
} {
  const rows: ParsedAttendanceRow[] = []
  let droppedRows = 0

  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: true })

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    })

    jsonRows.forEach((rawRow, index) => {
      const row = normalizeRow(rawRow)
      const date = parseDateValue(getValueByCandidates(row, ATTENDANCE_DATE_COLUMNS))
      const hours = parseAttendanceHoursFromRow(row)

      if (!date || hours == null || !Number.isFinite(hours) || hours <= 0) {
        droppedRows += 1
        return
      }

      const idText = sanitizeText(getValueByCandidates(row, ATTENDANCE_ID_COLUMNS))
      const nameText = sanitizeText(getValueByCandidates(row, ATTENDANCE_NAME_COLUMNS))
      const nameNick = sanitizeText(getValueByCandidates(row, ['昵称']))
      const nameFull = sanitizeText(getValueByCandidates(row, ['姓名', '员工姓名', '人员姓名', 'name']))
      const workdayText = sanitizeText(getValueByCandidates(row, ['工作日', 'Workday', 'workday']))
      const surnameText = sanitizeText(getValueByCandidates(row, ['姓氏', 'Surname', 'surname']))
      const positionTitle = sanitizeText(getValueByCandidates(row, ATTENDANCE_POSITION_TITLE_COLUMNS))
      const positionCode = sanitizeText(getValueByCandidates(row, ATTENDANCE_POSITION_CODE_COLUMNS))
      const clockInTime = adjustAttendanceClockTime(
        combineDateAndClockTime(date, getValueByCandidates(row, ATTENDANCE_CLOCK_IN_COLUMNS)),
      )
      const clockOutTime = adjustAttendanceClockTime(
        combineDateAndClockTime(date, getValueByCandidates(row, ATTENDANCE_CLOCK_OUT_COLUMNS)),
      )
      const sorterKey = idText || nameText
      const isFrontDesk = isFrontDeskPosition(positionTitle, positionCode)

      if (!sorterKey) {
        droppedRows += 1
        return
      }

      if (
        isExcludedSystemAttendanceRow({
          sorterKey,
          sorterName: nameText || idText,
          nameNick,
          nameFull,
        })
      ) {
        droppedRows += 1
        return
      }

      rows.push({
        date: formatDateKey(date),
        sorterKey,
        sorterName: nameText || idText,
        nameNick: nameNick || '',
        nameFull: nameFull || '',
        hours,
        clockInTime,
        clockOutTime,
        positionTitle: positionTitle || undefined,
        positionCode: positionCode || undefined,
        isFrontDesk,
        isSorterWorker: !isFrontDesk,
        workday: workdayText || undefined,
        surname: surnameText || undefined,
        sourceFileName: fileName,
        sourceSheetName: sheetName,
        sourceRowNumber: index + 2,
      })
    })
  })

  return { rows, droppedRows }
}

function allocationTimeSlot(date: Date): string {
  const hours = date.getHours()
  const minutes = date.getMinutes() < 30 ? 0 : 30
  const next = new Date(date)
  next.setHours(hours, minutes + 30, 0, 0)
  const start = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  const end = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
  return `${start}–${end}`
}

export function parseAllocationFileBuffer(buffer: ArrayBuffer, fileName: string): {
  rows: ParsedAllocationRow[]
  droppedRows: number
} {
  const rows: ParsedAllocationRow[] = []
  let droppedRows = 0

  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true })

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    })

    jsonRows.forEach((rawRow, index) => {
      const row = normalizeRow(rawRow)
      const allocationTime = parseDateValue(getValueByCandidates(row, ALLOCATION_TIME_COLUMNS))
      if (!allocationTime) {
        droppedRows += 1
        return
      }

      rows.push({
        allocationTime,
        date: formatDateKey(allocationTime),
        timeSlot: allocationTimeSlot(allocationTime),
        boxNo: sanitizeText(getValueByCandidates(row, ALLOCATION_BOX_COLUMNS)),
        driver: sanitizeText(getValueByCandidates(row, ALLOCATION_DRIVER_COLUMNS)),
        driverCompany: sanitizeText(getValueByCandidates(row, ALLOCATION_DRIVER_COMPANY_COLUMNS)),
        driverCode: sanitizeText(getValueByCandidates(row, ALLOCATION_DRIVER_NO_COLUMNS)),
        sourceFileName: fileName,
        sourceSheetName: sheetName,
        sourceRowNumber: index + 2,
      })
    })
  })

  return { rows, droppedRows }
}
