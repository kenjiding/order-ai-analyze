import type { TFunction } from 'i18next'
import * as XLSX from 'xlsx'
import type { AnalysisRow } from './analysisTypes'
import type { OrderQueryInfo } from './orderExceptionApi'

export const ANALYSIS_EXPORT_FIELDS = [
  'orderNo',
  'lossScope',
  'categoryName',
  'currentResponsibilityParty',
  'consigneeRouteCode',
  'confidence',
  'extraData',
  'reason',
  'needsReview',
  'crossCheckedModel',
  'latestResponsibilityPerson',
  'latestResponsibilityTime',
  'latestResponsibilityAction',
  'noOperationDays',
] as const

export type AnalysisExportField = (typeof ANALYSIS_EXPORT_FIELDS)[number]
export type AnalysisExportLabels = Record<AnalysisExportField, string>

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

/** Legacy zh-CN headers for import compatibility and tests */
export const ZH_ANALYSIS_EXPORT_LABELS: AnalysisExportLabels = {
  orderNo: '订单号',
  lossScope: '异常类型',
  categoryName: '子类型',
  currentResponsibilityParty: '当前责任站点',
  consigneeRouteCode: '路由码',
  confidence: '置信度',
  extraData: '额外数据',
  reason: '判定依据',
  needsReview: '是否需复核',
  crossCheckedModel: '交叉验证模型',
  latestResponsibilityPerson: '最新责任人',
  latestResponsibilityTime: '最新责任时间',
  latestResponsibilityAction: '最新责任操作',
  noOperationDays: '无操作天数',
}

const EXPORT_HEADER_ALIASES: Record<AnalysisExportField, readonly string[]> = {
  orderNo: ['订单号', 'Waybill No.'],
  lossScope: ['异常类型', 'Exception type'],
  categoryName: ['子类型', 'Sub-type'],
  currentResponsibilityParty: ['当前责任站点', 'Current responsible hub'],
  consigneeRouteCode: ['路由码', 'Route code'],
  confidence: ['置信度', 'Confidence'],
  extraData: ['额外数据', 'Extra data'],
  reason: ['判定依据', 'Determination basis'],
  needsReview: ['是否需复核', 'Needs review'],
  crossCheckedModel: ['交叉验证模型', 'Cross-check model'],
  latestResponsibilityPerson: ['最新责任人', 'Latest responsible person'],
  latestResponsibilityTime: ['最新责任时间', 'Latest responsibility time'],
  latestResponsibilityAction: ['最新责任操作', 'Latest responsibility action'],
  noOperationDays: ['无操作天数', 'Days idle'],
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, '')
    .trim()
    .replace(/[.:：．。]+$/u, '')
}

const HEADER_TO_FIELD = new Map<string, AnalysisExportField>(
  Object.entries(EXPORT_HEADER_ALIASES).flatMap(([field, aliases]) =>
    aliases.map((alias) => [normalizeHeader(alias), field as AnalysisExportField]),
  ),
)

export function getAnalysisExportLabels(t: TFunction): AnalysisExportLabels {
  return {
    orderNo: t('export.orderNo'),
    lossScope: t('export.exceptionType'),
    categoryName: t('export.subType'),
    currentResponsibilityParty: t('export.currentHub'),
    consigneeRouteCode: t('export.routeCode'),
    confidence: t('export.confidence'),
    extraData: t('export.extraData'),
    reason: t('export.reason'),
    needsReview: t('export.needsReview'),
    crossCheckedModel: t('export.crossCheckModel'),
    latestResponsibilityPerson: t('export.latestPerson'),
    latestResponsibilityTime: t('export.latestTime'),
    latestResponsibilityAction: t('export.latestAction'),
    noOperationDays: t('export.noOperationDays'),
  }
}

export function getAnalysisExportSheetName(t: TFunction): string {
  return t('export.sheetName')
}

export type AnalysisExportRow = Record<string, string | number>

/**
 * Column order matches ANALYSIS_EXPORT_FIELDS.
 */
export const ANALYSIS_EXPORT_COLUMN_WIDTHS = [24, 14, 16, 28, 16, 10, 44, 80, 12, 16, 20, 20, 24, 14] as const

const REQUIRED_IMPORT_FIELDS: AnalysisExportField[] = ['orderNo', 'lossScope']

export type ParseAnalysisResultsFromFileResult =
  | { ok: true; rows: AnalysisRow[]; fileName: string }
  | { ok: false; error: string }

function displayOrDash(value: string | null | undefined): string {
  const text = value?.trim()
  return text ? text : '—'
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


function normalizeRecord(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const field = HEADER_TO_FIELD.get(normalizeHeader(key))
    normalized[field ?? normalizeHeader(key)] = value
  }
  return normalized
}

export function toAnalysisExportRow(
  row: AnalysisRow,
  labels: AnalysisExportLabels = ZH_ANALYSIS_EXPORT_LABELS,
  t?: TFunction,
): AnalysisExportRow {
  const yes = t ? t('export.yes') : '是'
  const no = t ? t('export.no') : '否'
  return {
    [labels.orderNo]: row.orderNo,
    [labels.lossScope]: row.lossScope,
    [labels.categoryName]: row.categoryName,
    [labels.currentResponsibilityParty]: row.currentResponsibilityParty,
    [labels.consigneeRouteCode]: row.orderInfo?.consigneeRouteCode || '—',
    [labels.confidence]: row.confidence,
    [labels.extraData]: row.extraData?.summary ?? '—',
    [labels.reason]: row.reason,
    [labels.needsReview]: row.needsReview ? yes : no,
    [labels.crossCheckedModel]: row.crossCheckedBy
      ? (CROSS_CHECKED_LABEL[row.crossCheckedBy] ?? row.crossCheckedBy)
      : '—',
    [labels.latestResponsibilityPerson]: row.latestResponsibility?.person ?? '—',
    [labels.latestResponsibilityTime]: row.latestResponsibility?.displayTime ?? '—',
    [labels.latestResponsibilityAction]: row.latestResponsibility?.action ?? '—',
    [labels.noOperationDays]: row.latestResponsibility ? row.latestResponsibility.noOperationDays : '—',
  }
}

export function analysisRowFromExportRecord(raw: Record<string, unknown>): AnalysisRow | null {
  const record = normalizeRecord(raw)
  const orderNo = cellToText(record.orderNo)
  if (!orderNo) return null

  const routeCode = cellToText(record.consigneeRouteCode)
  const extraSummary = cellToText(record.extraData)
  const person = cellToText(record.latestResponsibilityPerson)
  const displayTime = cellToText(record.latestResponsibilityTime)
  const action = cellToText(record.latestResponsibilityAction)
  const daysRaw = record.noOperationDays
  const daysText = cellToText(daysRaw)
  const noOperationDays = Number(daysRaw === '' || daysText === '—' ? Number.NaN : daysText)
  const hasResponsibility =
    !isBlankDisplay(person) ||
    !isBlankDisplay(displayTime) ||
    !isBlankDisplay(action) ||
    Number.isFinite(noOperationDays)
  const crossCheckedRaw = cellToText(record.crossCheckedModel)
  const crossCheckedBy = CROSS_CHECKED_FROM_LABEL[crossCheckedRaw] ?? null
  const needsReviewText = cellToText(record.needsReview)

  return {
    orderNo,
    lossScope: displayOrDash(cellToText(record.lossScope)),
    categoryName: displayOrDash(cellToText(record.categoryName)),
    currentResponsibilityParty: displayOrDash(cellToText(record.currentResponsibilityParty)),
    reason: displayOrDash(cellToText(record.reason)),
    confidence: displayOrDash(cellToText(record.confidence)),
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
    needsReview: needsReviewText === '是' || needsReviewText === 'Yes',
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

function parseRecords(
  records: Record<string, unknown>[],
  t: TFunction,
): ParseAnalysisResultsFromFileResult {
  if (!records.length) return { ok: false, error: t('export.noDataRows') }

  const headers = new Set(Object.keys(normalizeRecord(records[0] ?? {})))
  const missing = REQUIRED_IMPORT_FIELDS.filter((field) => !headers.has(field))
  if (missing.length) {
    const labels = getAnalysisExportLabels(t)
    const missingLabels = missing.map((field) => labels[field])
    return {
      ok: false,
      error: t('export.missingHeaders', { headers: missingLabels.join('、') }),
    }
  }

  const rows = analysisRowsFromExportRecords(records)
  if (!rows.length) return { ok: false, error: t('export.noOrderNoFound') }
  return { ok: true, rows, fileName: '' }
}

function parseWorkbook(wb: XLSX.WorkBook, t: TFunction): ParseAnalysisResultsFromFileResult {
  const sheetNameCandidates = [getAnalysisExportSheetName(t), '分析结果', 'Analysis results']
  const sheetName =
    wb.SheetNames.find((name) => sheetNameCandidates.includes(name)) ?? wb.SheetNames[0]
  if (!sheetName) return { ok: false, error: t('export.emptySheet') }
  const sheet = wb.Sheets[sheetName]
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return parseRecords(records, t)
}

export async function parseAnalysisResultsFromFile(
  file: File,
  t?: TFunction,
): Promise<ParseAnalysisResultsFromFileResult> {
  const translate =
    t ?? (await import('../../i18n')).i18n.getFixedT(null, 'orderException')
  const name = file.name.toLowerCase()
  let workbook: XLSX.WorkBook
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    workbook = XLSX.read(await file.text(), { type: 'string', cellDates: false, raw: true })
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, raw: true })
  } else {
    return { ok: false, error: translate('export.unsupportedFile') }
  }

  const parsed = parseWorkbook(workbook, translate)
  if (!parsed.ok) return parsed
  return { ...parsed, fileName: file.name }
}
