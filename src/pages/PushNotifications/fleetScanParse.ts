import * as XLSX from 'xlsx'
import type { FleetScanRow } from './fleetSupplierPushTypes'

/**
 * 表头候选项（normalizeHeader 后与 normalizeRow 的键一致）。
 * 城市/邮编：优先「收件人城市」「收件人邮编」；若无则用「城市」「邮政编码」等别名（两套导出模板列名不同、数据一致）。
 */
const ROUTE_CODE_COLUMNS = [
  '路由编码',
  '线路编码',
  '线路',
  'RouteCode',
  'route_code',
  'routeCode',
  'ROUTECODE',
] as const

const POSTCODE_COLUMNS = [
  '收件人邮编',
  '收件邮编',
  '邮编',
  '邮政编码',
  'Postcode',
  'postal_code',
  'ZIP',
  'zip',
  'ZipCode',
] as const

const CITY_COLUMNS = ['收件人城市', '收件城市', '城市', '市', 'City', 'city', 'RecipientCity'] as const

const ORDER_KEY_COLUMNS = [
  '运单号',
  '运单',
  '跟踪号',
  '订单号',
  '单号',
  'TrackingNumber',
  'tracking_number',
  'waybill',
  'WaybillNo',
] as const

// 可选列：不识别时留空，不影响其余字段解析（优先客户统计跳过即可）
const CLIENT_CODE_COLUMNS = [
  '商家编码',
  '商家编号',
  '客户编码',
  'ClientCode',
  'client_code',
  'clientCode',
] as const

// 英文版模板列名大小写/分隔符与中文版不一致（Post Code / POSTAL_CODE …），统一压平后再比对
const normalizeHeader = (value: unknown): string =>
  String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/[\s._:：．。\-/\\()（）]+/gu, '')
    .toLowerCase()

const normalizeRow = (rawRow: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {}
  Object.keys(rawRow || {}).forEach((key) => {
    normalized[normalizeHeader(key)] = rawRow[key]
  })
  return normalized
}

const sanitizeText = (value: unknown): string => {
  if (value == null) return ''
  return String(value).trim()
}

const hasValue = (value: unknown): boolean =>
  value !== null && value !== undefined && String(value).trim() !== ''

const getValueByCandidates = (row: Record<string, unknown>, candidates: readonly string[]): unknown => {
  const normalizedCandidates = candidates.map(normalizeHeader)
  for (const normalizedKey of normalizedCandidates) {
    if (hasValue(row[normalizedKey])) return row[normalizedKey]
  }
  // 兜底：列名带前后缀（RecipientPostCode、DestinationZipCode…）时按包含关系命中
  const key = Object.keys(row).find(
    (k) => hasValue(row[k]) && normalizedCandidates.some((c) => k.includes(c)),
  )
  return key ? row[key] : null
}

export type FleetScanParseResult = {
  rows: FleetScanRow[]
  droppedRows: number
  fileNames: string[]
}

function parseWorkbook(workbook: XLSX.WorkBook, fileName: string): { rows: FleetScanRow[]; droppedRows: number } {
  const rows: FleetScanRow[] = []
  let droppedRows = 0

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    })

    jsonRows.forEach((rawRow, index) => {
      const row = normalizeRow(rawRow)
      const routeCode = sanitizeText(getValueByCandidates(row, ROUTE_CODE_COLUMNS))
      if (!routeCode) {
        droppedRows += 1
        return
      }

      const postcode = sanitizeText(getValueByCandidates(row, POSTCODE_COLUMNS)) || '—'
      const city = sanitizeText(getValueByCandidates(row, CITY_COLUMNS)) || '—'
      const explicitOrderKey = sanitizeText(getValueByCandidates(row, ORDER_KEY_COLUMNS))
      const orderKey =
        explicitOrderKey ||
        `${fileName}#${sheetName}#${index + 2}:${routeCode}|${postcode}|${city}`
      const clientCode = sanitizeText(getValueByCandidates(row, CLIENT_CODE_COLUMNS))

      rows.push({
        routeCode,
        postcode,
        city,
        orderKey,
        ...(clientCode ? { clientCode } : {}),
        sourceSheet: sheetName,
        sourceRowNumber: index + 2,
      })
    })
  })

  return { rows, droppedRows }
}

export async function parseFleetScanFiles(files: File[]): Promise<FleetScanParseResult> {
  const rows: FleetScanRow[] = []
  let droppedRows = 0
  const fileNames: string[] = []

  for (const file of files) {
    fileNames.push(file.name)
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    let workbook: XLSX.WorkBook
    if (ext === 'csv') {
      const text = await file.text()
      workbook = XLSX.read(text, { type: 'string', cellDates: true, raw: true })
    } else {
      const buffer = await file.arrayBuffer()
      workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true })
    }
    const part = parseWorkbook(workbook, file.name)
    rows.push(...part.rows)
    droppedRows += part.droppedRows
  }

  return { rows, droppedRows, fileNames }
}
