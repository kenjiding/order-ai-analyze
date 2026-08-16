import * as XLSX from 'xlsx'
import type { AnalysisRow } from './analysisTypes'
import type { OrderQueryInfo } from './orderExceptionApi'

export const ANALYSIS_EXPORT_SHEET_NAME = '分析结果'

export const CROSS_CHECKED_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
}

const CROSS_CHECKED_FROM_LABEL: Record<string, 'openai' | 'deepseek'> = {
  openai: 'openai',
  deepseek: 'deepseek',
  OpenAI: 'openai',
  DeepSeek: 'deepseek',
}

export type AnalysisExportRow = {
  订单号: string
  异常类型: string
  子类型: string
  当前责任站点: string
  路由码: string
  置信度: string
  额外数据: string
  判定依据: string
  是否需复核: string
  交叉验证模型: string
  最新责任人: string
  最新责任时间: string
  最新责任操作: string
  无操作天数: string | number
}

/**
 * 与 toAnalysisExportRow 列顺序一致：订单号、异常类型、子类型、当前责任站点、路由码、置信度、额外数据、
 * 判定依据、是否需复核、交叉验证模型、最新责任人、最新责任时间、最新责任操作、无操作天数
 */
export const ANALYSIS_EXPORT_COLUMN_WIDTHS = [24, 14, 16, 28, 16, 10, 44, 80, 12, 16, 20, 20, 24, 14] as const

const REQUIRED_IMPORT_HEADERS = ['订单号', '异常类型'] as const

export type ParseAnalysisResultsFromFileResult =
  | { ok: true; rows: AnalysisRow[]; fileName: string }
  | { ok: false; error: string }

function displayOrDash(value: string | null | undefined): string {
  const text = value?.trim()
  return text ? text : '—'
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, '')
    .trim()
    .replace(/[.:：．。]+$/u, '')
}

function cellToText(value: unknown): string {
  if (value == null || value === '') return ''
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      return value.toLocaleString('en-US', { maximumFractionDigits: 0, useGrouping: false })
    }
    return String(value)
  }
  return String(value).replace(/\uFEFF/g, '').trim()
}

function isBlankDisplay(value: string): boolean {
  return !value || value === '—'
}

function emptyOrderInfo(consigneeRouteCode: string): OrderQueryInfo {
  return {
    merchantName: '',
    merchantCode: '',
    totalWeight: '',
    customerDeclaredValueAud: '',
    declaredValueUsd: '',
    consigneeRouteCode,
  }
}

function pick(record: Record<string, unknown>, header: string): unknown {
  return record[normalizeHeader(header)]
}

function normalizeRecord(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeHeader(key)] = value
  }
  return normalized
}

export function toAnalysisExportRow(row: AnalysisRow): AnalysisExportRow {
  return {
    订单号: row.orderNo,
    异常类型: row.lossScope,
    子类型: row.categoryName,
    当前责任站点: row.currentResponsibilityParty,
    路由码: row.orderInfo?.consigneeRouteCode || '—',
    置信度: row.confidence,
    额外数据: row.extraData?.summary ?? '—',
    判定依据: row.reason,
    是否需复核: row.needsReview ? '是' : '否',
    交叉验证模型: row.crossCheckedBy ? (CROSS_CHECKED_LABEL[row.crossCheckedBy] ?? row.crossCheckedBy) : '—',
    最新责任人: row.latestResponsibility?.person ?? '—',
    最新责任时间: row.latestResponsibility?.displayTime ?? '—',
    最新责任操作: row.latestResponsibility?.action ?? '—',
    无操作天数: row.latestResponsibility ? row.latestResponsibility.noOperationDays : '—',
  }
}

export function analysisRowFromExportRecord(raw: Record<string, unknown>): AnalysisRow | null {
  const record = normalizeRecord(raw)
  const orderNo = cellToText(pick(record, '订单号'))
  if (!orderNo) return null

  const routeCode = cellToText(pick(record, '路由码'))
  const extraSummary = cellToText(pick(record, '额外数据'))
  const person = cellToText(pick(record, '最新责任人'))
  const displayTime = cellToText(pick(record, '最新责任时间'))
  const action = cellToText(pick(record, '最新责任操作'))
  const daysRaw = pick(record, '无操作天数')
  const daysText = cellToText(daysRaw)
  const noOperationDays = Number(daysRaw === '' || daysText === '—' ? Number.NaN : daysText)
  const hasResponsibility =
    !isBlankDisplay(person) ||
    !isBlankDisplay(displayTime) ||
    !isBlankDisplay(action) ||
    Number.isFinite(noOperationDays)
  const crossCheckedRaw = cellToText(pick(record, '交叉验证模型'))
  const crossCheckedBy = CROSS_CHECKED_FROM_LABEL[crossCheckedRaw] ?? null
  const needsReviewText = cellToText(pick(record, '是否需复核'))

  return {
    orderNo,
    lossScope: displayOrDash(cellToText(pick(record, '异常类型'))),
    categoryName: displayOrDash(cellToText(pick(record, '子类型'))),
    currentResponsibilityParty: displayOrDash(cellToText(pick(record, '当前责任站点'))),
    reason: displayOrDash(cellToText(pick(record, '判定依据'))),
    confidence: displayOrDash(cellToText(pick(record, '置信度'))),
    trackEvents: [],
    interceptLogs: [],
    status: 'done',
    orderInfo: isBlankDisplay(routeCode) ? null : emptyOrderInfo(routeCode),
    extraData:
      isBlankDisplay(extraSummary)
        ? undefined
        : {
            summary: extraSummary,
            entries: [],
          },
    needsReview: needsReviewText === '是',
    crossCheckedBy,
    latestResponsibility: hasResponsibility
      ? {
          source: 'track',
          owner: 'in_warehouse',
          time: isBlankDisplay(displayTime) ? '' : displayTime,
          displayTime: displayOrDash(displayTime),
          person: displayOrDash(person),
          action: displayOrDash(action),
          noOperationDays: Number.isFinite(noOperationDays) ? noOperationDays : 0,
        }
      : null,
  }
}

export function analysisRowsFromExportRecords(records: Record<string, unknown>[]): AnalysisRow[] {
  const byOrderNo = new Map<string, AnalysisRow>()
  for (const record of records) {
    const row = analysisRowFromExportRecord(record)
    if (!row) continue
    byOrderNo.set(row.orderNo, row)
  }
  return [...byOrderNo.values()]
}

function parseRecords(records: Record<string, unknown>[]): ParseAnalysisResultsFromFileResult {
  if (!records.length) return { ok: false, error: '表格没有数据行' }

  const headers = new Set(Object.keys(normalizeRecord(records[0] ?? {})))
  const missing = REQUIRED_IMPORT_HEADERS.filter((header) => !headers.has(normalizeHeader(header)))
  if (missing.length) {
    return {
      ok: false,
      error: `不是分析结果导出表，缺少「${missing.join('、')}」列。请使用本页「导出 Excel」生成的文件。`,
    }
  }

  const rows = analysisRowsFromExportRecords(records)
  if (!rows.length) return { ok: false, error: '未识别到订单号' }
  return { ok: true, rows, fileName: '' }
}

function parseWorkbook(wb: XLSX.WorkBook): ParseAnalysisResultsFromFileResult {
  const sheetName = wb.SheetNames.includes(ANALYSIS_EXPORT_SHEET_NAME)
    ? ANALYSIS_EXPORT_SHEET_NAME
    : wb.SheetNames[0]
  if (!sheetName) return { ok: false, error: '表格为空' }
  const sheet = wb.Sheets[sheetName]
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return parseRecords(records)
}

export async function parseAnalysisResultsFromFile(file: File): Promise<ParseAnalysisResultsFromFileResult> {
  const name = file.name.toLowerCase()
  let workbook: XLSX.WorkBook
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    workbook = XLSX.read(await file.text(), { type: 'string', cellDates: false, raw: true })
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, raw: true })
  } else {
    return { ok: false, error: '请使用本页导出的 .xlsx / .xls / .csv 文件' }
  }

  const parsed = parseWorkbook(workbook)
  if (!parsed.ok) return parsed
  return { ...parsed, fileName: file.name }
}
