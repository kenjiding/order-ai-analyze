import * as XLSX from 'xlsx'
import { i18n } from '../../i18n'
import { parseOrderNumbersUnique } from '../../utils/orderNoInput'

const ORDER_NO_COLUMNS = [
  '订单号',
  '运单号',
  '运单',
  '跟踪号',
  '单号',
  'Waybill No.',
  'WaybillNo',
  'TrackingNumber',
  'tracking_number',
  'waybill',
  'waybillNo',
  'WAYBILLNO',
] as const

function te(key: string): string {
  return i18n.t(key, { ns: 'orderException' })
}

export type ParseOrderNumbersFromFileResult =
  | { ok: true; orderNos: string[]; sourceLabel: string }
  | { ok: false; error: string }

function normalizeHeader(value: unknown): string {
  let s = String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, '')
    .trim()
  s = s.replace(/[.:：．。]+$/u, '')
  return s
}

function cellToOrderNo(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      return value.toLocaleString('en-US', { maximumFractionDigits: 0, useGrouping: false })
    }
    return String(value)
  }
  return String(value).replace(/\uFEFF/g, '').trim()
}

function normalizeRecord(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeHeader(key)] = value
  }
  return normalized
}

function findOrderNoColumnKey(row: Record<string, unknown>): string | null {
  for (const col of ORDER_NO_COLUMNS) {
    const key = normalizeHeader(col)
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = cellToOrderNo(row[key])
      if (value) return key
    }
  }
  return null
}

function extractOrderNosFromRecords(rows: Record<string, unknown>[]): string[] {
  if (!rows.length) return []

  const normalizedRows = rows.map(normalizeRecord)
  const orderNoKey = findOrderNoColumnKey(normalizedRows[0] ?? {})
  if (orderNoKey) {
    const values = normalizedRows.map((row) => cellToOrderNo(row[orderNoKey])).filter(Boolean)
    return parseOrderNumbersUnique(values.join('\n'))
  }

  const firstRawKey = Object.keys(rows[0] ?? {})[0]
  if (firstRawKey) {
    const values = rows.map((row) => cellToOrderNo(row[firstRawKey])).filter(Boolean)
    if (values.length) return parseOrderNumbersUnique(values.join('\n'))
  }

  return []
}

function extractOrderNosFromMatrix(matrix: unknown[][]): string[] {
  const values = matrix
    .map((row) => (Array.isArray(row) ? cellToOrderNo(row[0]) : ''))
    .filter(Boolean)
  return parseOrderNumbersUnique(values.join('\n'))
}

function parseWorkbook(buf: ArrayBuffer): ParseOrderNumbersFromFileResult {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { ok: false, error: te('parseOrderFile.emptySheet') }

  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  let orderNos = extractOrderNosFromRecords(rows)

  if (!orderNos.length) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
    orderNos = extractOrderNosFromMatrix(matrix)
  }

  if (!orderNos.length) return { ok: false, error: te('parseOrderFile.noOrderNoInSheet') }
  return { ok: true, orderNos, sourceLabel: sheetName }
}

function parseCsvText(text: string, sourceLabel: string): ParseOrderNumbersFromFileResult {
  const wb = XLSX.read(text, { type: 'string', cellDates: false, raw: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { ok: false, error: te('parseOrderFile.emptyCsv') }

  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  let orderNos = extractOrderNosFromRecords(rows)

  if (!orderNos.length) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
    orderNos = extractOrderNosFromMatrix(matrix)
  }

  if (!orderNos.length) return { ok: false, error: te('parseOrderFile.noOrderNoInSheet') }
  return { ok: true, orderNos, sourceLabel }
}

export async function parseOrderNumbersFromFile(file: File): Promise<ParseOrderNumbersFromFileResult> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.txt') || file.type === 'text/plain') {
    const text = await file.text()
    const orderNos = parseOrderNumbersUnique(text)
    if (!orderNos.length) return { ok: false, error: te('parseOrderFile.noOrderNoInText') }
    return { ok: true, orderNos, sourceLabel: file.name }
  }

  if (name.endsWith('.csv') || file.type === 'text/csv') {
    const text = await file.text()
    return parseCsvText(text, file.name)
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer()
    const result = parseWorkbook(buf)
    if (!result.ok) return result
    return { ...result, sourceLabel: file.name }
  }

  return { ok: false, error: te('parseOrderFile.unsupportedFile') }
}
