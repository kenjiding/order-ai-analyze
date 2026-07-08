import type { ParsedAllocationRow } from './aggregates'
import { formatDateKey, formatDateTime, parseDateValue, sanitizeText } from './formatAndParse'

function allocationTimeSlot(date: Date): string {
  const hours = date.getHours()
  const minutes = date.getMinutes() < 30 ? 0 : 30
  const next = new Date(date)
  next.setHours(hours, minutes + 30, 0, 0)
  const start = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  const end = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
  return `${start}–${end}`
}

function normalizeAssignedListRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function readBoxNo(record: Record<string, unknown>): string {
  const candidates = ['boxNo', 'boxCode', 'containerNo', 'packageNo', 'batchNo']
  for (const key of candidates) {
    const value = sanitizeText(record[key])
    if (value) return value
  }
  return sanitizeText(record.routeCode)
}

export function mapAssignedListRecordsToParsedAllocationRows(
  records: unknown[],
  sourceLabel: string,
): { rows: ParsedAllocationRow[]; droppedRows: number } {
  const rows: ParsedAllocationRow[] = []
  let droppedRows = 0

  records.forEach((raw, index) => {
    const record = normalizeAssignedListRecord(raw)
    if (!record) {
      droppedRows += 1
      return
    }

    const allocationTime = parseDateValue(record.assignTime)
    if (!allocationTime) {
      droppedRows += 1
      return
    }

    rows.push({
      allocationTime,
      date: formatDateKey(allocationTime),
      timeSlot: allocationTimeSlot(allocationTime),
      boxNo: readBoxNo(record),
      driver: sanitizeText(record.assignDaName),
      driverCompany: sanitizeText(record.driverCompany),
      driverCode: sanitizeText(record.routeCode),
      sourceFileName: sourceLabel,
      sourceSheetName: 'assignedList',
      sourceRowNumber: index + 1,
    })
  })

  return { rows, droppedRows }
}

export function dedupeParsedAllocationRows(rows: ParsedAllocationRow[]): {
  rows: ParsedAllocationRow[]
  duplicateDropped: number
} {
  const seen = new Set<string>()
  const deduped: ParsedAllocationRow[] = []
  let duplicateDropped = 0

  for (const row of rows) {
    const key = [
      formatDateTime(row.allocationTime),
      row.driverCode,
      row.driver,
      row.driverCompany,
      row.boxNo,
    ].join('\0')
    if (seen.has(key)) {
      duplicateDropped += 1
      continue
    }
    seen.add(key)
    deduped.push(row)
  }

  return { rows: deduped, duplicateDropped }
}
