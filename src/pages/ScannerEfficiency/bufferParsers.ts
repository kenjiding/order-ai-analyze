/**
 * 同步解析单个 Excel 缓冲区（供 Web Worker 或主线程兜底调用）。
 * 避免在 React 主线程直接调用 XLSX.read 大文件导致长时间阻塞。
 */
import * as XLSX from 'xlsx'
import {
  ATTENDANCE_DATE_COLUMNS,
  ATTENDANCE_DURATION_COLUMNS,
  ATTENDANCE_ID_COLUMNS,
  ATTENDANCE_NAME_COLUMNS,
  SCANNER_COLUMNS,
  SCAN_TIME_COLUMNS,
  SORTING_REQUIRED_COLUMNS,
  TRACKING_COLUMNS,
} from './constants'
import type { ParsedAttendanceRow, ParsedScanRow } from './aggregates'
import {
  formatDateKey,
  getValueByCandidates,
  normalizeRow,
  parseDateValue,
  parseDurationToHours,
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
      const hours = parseDurationToHours(getValueByCandidates(row, ATTENDANCE_DURATION_COLUMNS))

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
      const sorterKey = idText || nameText

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
