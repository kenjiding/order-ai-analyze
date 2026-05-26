import * as XLSX from 'xlsx'
import type { FleetSupplierConfig } from './fleetSupplierPushTypes'
import { createFleetSupplierId, sanitizeFleetSupplier } from './fleetSupplierStorage'

export const FLEET_SUPPLIER_EXPORT_SHEET_NAME = '供应商配置'

function cellToStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/** 将表格行（中英表头）转为 sanitize 输入 */
export function fleetSupplierRowFromSheetRecord(row: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(row, k)) {
        const v = row[k]
        if (v != null && v !== '') return v
      }
    }
    return undefined
  }
  return {
    id: pick('id', 'ID'),
    supplierName: pick('supplierName', '供应商名称'),
    routeCode: pick('routeCode', '路由编码'),
    webhookUrl: pick('webhookUrl', '飞书 webhook', 'webhook'),
    signingSecret: pick('signingSecret', '密钥', '飞书 webhook 密钥', 'signing_secret'),
    pushContent: pick('pushContent', '供应商推送内容', '推送内容'),
  }
}

export function fleetSuppliersToExportRows(
  list: FleetSupplierConfig[],
  options: { includeSecrets: boolean },
): Record<string, string>[] {
  return list.map((s) => {
    const base: Record<string, string> = {
      id: s.id,
      supplierName: s.supplierName,
      routeCode: s.routeCode,
      pushContent: s.pushContent,
    }
    if (options.includeSecrets) {
      base.webhookUrl = s.webhookUrl
      base.signingSecret = s.signingSecret ?? ''
    }
    return base
  })
}

export function buildFleetSuppliersXlsxBlob(
  list: FleetSupplierConfig[],
  options: { includeSecrets: boolean },
): Blob {
  const rows = fleetSuppliersToExportRows(list, options)
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, FLEET_SUPPLIER_EXPORT_SHEET_NAME)
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export type FleetSupplierImportParseResult =
  | { ok: true; suppliers: FleetSupplierConfig[] }
  | { ok: false; error: string }

function parseJsonArray(text: string): FleetSupplierImportParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { ok: false, error: 'JSON 解析失败' }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'JSON 根节点须为数组' }
  }
  const out: FleetSupplierConfig[] = []
  const gen = () => createFleetSupplierId()
  for (const item of parsed) {
    const s = sanitizeFleetSupplier(item, { generateId: gen })
    if (s) out.push(s)
  }
  if (!out.length) return { ok: false, error: '未解析到有效供应商记录' }
  return { ok: true, suppliers: out }
}

function parseSheetRows(rows: Record<string, unknown>[]): FleetSupplierImportParseResult {
  if (!rows.length) return { ok: false, error: '表格无数据行' }

  const out: FleetSupplierConfig[] = []
  const gen = () => createFleetSupplierId()

  for (const raw of rows) {
    const mapped = fleetSupplierRowFromSheetRecord(raw)
    const normalized = {
      ...mapped,
      id: cellToStr(mapped.id),
      supplierName: cellToStr(mapped.supplierName),
      routeCode: cellToStr(mapped.routeCode),
      webhookUrl: cellToStr(mapped.webhookUrl),
      signingSecret: cellToStr(mapped.signingSecret),
      pushContent: cellToStr(mapped.pushContent),
    }
    if (!normalized.supplierName && !normalized.routeCode && !normalized.webhookUrl) continue
    const signingSecret =
      normalized.signingSecret.trim() !== '' ? normalized.signingSecret.trim() : undefined
    const s = sanitizeFleetSupplier(
      { ...normalized, signingSecret },
      { generateId: gen },
    )
    if (s) out.push(s)
  }

  if (!out.length) return { ok: false, error: '未解析到有效供应商记录' }
  return { ok: true, suppliers: out }
}

function parseWorkbook(buf: ArrayBuffer): FleetSupplierImportParseResult {
  const wb = XLSX.read(buf, { type: 'array' })
  const name = wb.SheetNames[0]
  if (!name) return { ok: false, error: '表格为空' }
  const sheet = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return parseSheetRows(rows)
}

export async function parseFleetSuppliersImportFile(file: File): Promise<FleetSupplierImportParseResult> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.json') || file.type === 'application/json') {
    const text = await file.text()
    return parseJsonArray(text)
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer()
    return parseWorkbook(buf)
  }

  if (name.endsWith('.csv')) {
    const text = await file.text()
    const wb = XLSX.read(text, { type: 'string' })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) return { ok: false, error: 'CSV 无内容' }
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    return parseSheetRows(rows)
  }

  return { ok: false, error: '不支持该文件类型，请使用 .xlsx / .xls / .csv / .json' }
}

export function mergeFleetSupplierImports(
  current: FleetSupplierConfig[],
  imported: FleetSupplierConfig[],
): FleetSupplierConfig[] {
  const byId = new Map<string, FleetSupplierConfig>()
  for (const s of current) byId.set(s.id, s)
  for (const s of imported) byId.set(s.id, s)
  return Array.from(byId.values())
}
