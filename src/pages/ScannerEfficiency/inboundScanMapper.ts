import type { ParsedScanRow } from './aggregates'
import { parseDateValue, sanitizeText, getValueByCandidates } from './formatAndParse'
import {
  normalizeInboundApiRecord,
  isExcludedScanIdentity,
  normalizeScannerForVolume,
  readInboundScanRowExtras,
} from './scanInboundFieldMap'
import {
  SCAN_CLIENT_CODE_COLUMNS,
  SCAN_CLIENT_NAME_COLUMNS,
  SCAN_CONSIGNEE_CITY_COLUMNS,
  SCAN_CONSIGNEE_ZIP_COLUMNS,
  SCAN_DELIVERY_STATION_COLUMNS,
  SCAN_ROUTE_CODE_COLUMNS,
  SCAN_STATION_COLUMNS,
  SCANNER_COLUMNS,
  SORTING_REQUIRED_COLUMNS,
  SCAN_TIME_COLUMNS,
  TRACKING_COLUMNS,
} from './constants'

function isExcludedSortingScanner(value: string): boolean {
  return isExcludedScanIdentity(value)
}

function buildSortingFields(input: {
  scanTime: Date
  trackingNumber: string
  scanner: string
  sortingScanTime: Date | null
  sortingTrackingNumber: string
  sortingScanner: string
}): Pick<ParsedScanRow, 'sortingScanTime' | 'sortingTrackingNumber' | 'sortingScanner' | 'sortingEligible'> {
  const sortingScanner = input.sortingScanner.trim()
  const sortingTrackingNumber = input.sortingTrackingNumber.trim()
  const sortingScanTime = input.sortingScanTime
  const sortingEligible = Boolean(
    sortingScanTime &&
      sortingTrackingNumber &&
      sortingScanner &&
      !isExcludedSortingScanner(sortingScanner),
  )

  // API 路径：无独立分拣列时，用扫描员列作为分拣依据
  if (!sortingEligible && input.scanner) {
    return {
      sortingScanTime: input.scanTime,
      sortingTrackingNumber: input.trackingNumber,
      sortingScanner: input.scanner,
      sortingEligible: true,
    }
  }

  return { sortingScanTime, sortingTrackingNumber, sortingScanner, sortingEligible }
}

export function mapInboundRecordsToParsedScanRows(
  records: unknown[],
  sourceLabel: string,
): { rows: ParsedScanRow[]; droppedRows: number; sortingEligibleCount: number } {
  const rows: ParsedScanRow[] = []
  let droppedRows = 0
  let sortingEligibleCount = 0

  records.forEach((raw, index) => {
    const record = normalizeInboundApiRecord(raw)
    if (!record) {
      droppedRows += 1
      return
    }

    const scanTime = parseDateValue(record.scanDate)
    const trackingNumber = record.waybillNo.trim()
    if (!scanTime || !trackingNumber) {
      droppedRows += 1
      return
    }

    const { scanner } = normalizeScannerForVolume(record.operator)
    const extras = readInboundScanRowExtras(record)
    const sorting = buildSortingFields({
      scanTime,
      trackingNumber,
      scanner,
      sortingScanTime: null,
      sortingTrackingNumber: '',
      sortingScanner: '',
    })
    if (sorting.sortingEligible) sortingEligibleCount += 1

    rows.push({
      scanTime,
      trackingNumber,
      scanner,
      ...extras,
      ...sorting,
      sourceFileName: sourceLabel,
      sourceSheetName: record.scanType || 'inbound',
      sourceRowNumber: index + 1,
    })
  })

  return { rows, droppedRows, sortingEligibleCount }
}

export function mapExcelRowToParsedScanRow(input: {
  row: Record<string, unknown>
  fileName: string
  sheetName: string
  rowNumber: number
}): ParsedScanRow | null {
  const row = input.row
  const scanTime = parseDateValue(getValueByCandidates(row, SCAN_TIME_COLUMNS))
  if (!scanTime) return null

  const trackingNumber = sanitizeText(getValueByCandidates(row, TRACKING_COLUMNS))
  const { scanner } = normalizeScannerForVolume(sanitizeText(getValueByCandidates(row, SCANNER_COLUMNS)))

  const sortingScanTime = parseDateValue(getValueByCandidates(row, [SORTING_REQUIRED_COLUMNS[0]]))
  const sortingTrackingNumber = sanitizeText(getValueByCandidates(row, [SORTING_REQUIRED_COLUMNS[1]]))
  const sortingScanner = sanitizeText(getValueByCandidates(row, [SORTING_REQUIRED_COLUMNS[2]]))
  const sorting = buildSortingFields({
    scanTime,
    trackingNumber,
    scanner,
    sortingScanTime,
    sortingTrackingNumber,
    sortingScanner,
  })

  return {
    scanTime,
    trackingNumber,
    scanner,
    routeCode: sanitizeText(getValueByCandidates(row, SCAN_ROUTE_CODE_COLUMNS)),
    consigneeZipCode: sanitizeText(getValueByCandidates(row, SCAN_CONSIGNEE_ZIP_COLUMNS)),
    deliveryStation: sanitizeText(getValueByCandidates(row, SCAN_DELIVERY_STATION_COLUMNS)),
    scanStation: sanitizeText(getValueByCandidates(row, SCAN_STATION_COLUMNS)),
    clientCode: sanitizeText(getValueByCandidates(row, SCAN_CLIENT_CODE_COLUMNS)),
    clientName: sanitizeText(getValueByCandidates(row, SCAN_CLIENT_NAME_COLUMNS)),
    consigneeCity: sanitizeText(getValueByCandidates(row, SCAN_CONSIGNEE_CITY_COLUMNS)),
    ...sorting,
    sourceFileName: input.fileName,
    sourceSheetName: input.sheetName,
    sourceRowNumber: input.rowNumber,
  }
}
