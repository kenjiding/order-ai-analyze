import * as XLSX from 'xlsx'
import type { FleetSupplierConfig, FleetSupplierImportRow } from './fleetSupplierPushTypes'
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
    vendorCode: pick('vendorCode', '供应商编码', 'vendor_code'),
    vendorName: pick('vendorName', '供应商名称', 'vendor_name'),
    supplierNickname: pick('supplierNickname', '供应商昵称', 'supplier_nickname'),
    /** 旧版导出列名；仅回填 supplierNickname / vendorName，不当作 vendorCode */
    supplierName: pick('supplierName'),
    routeCode: pick('routeCode', '路由编码', '路由码'),
    webhookUrl: pick('webhookUrl', '飞书 webhook', 'webhook'),
    signingSecret: pick('signingSecret', '密钥', '飞书 webhook 密钥', 'signing_secret'),
    pushContent: pick('pushContent', '供应商推送内容', '推送内容'),
  }
}

export type FleetSupplierVendorLookup = { vendorCode: string; vendorNameEn: string }

export type FleetSupplierImportOptions = {
  vendors?: FleetSupplierVendorLookup[]
}

function normVendorKey(value: string): string {
  return value.trim().toLowerCase()
}

function lookupVendorByHint(
  hint: string,
  vendors: FleetSupplierVendorLookup[],
): FleetSupplierVendorLookup | undefined {
  const key = normVendorKey(hint)
  if (!key) return undefined
  return vendors.find(
    (v) => normVendorKey(v.vendorCode) === key || normVendorKey(v.vendorNameEn) === key,
  )
}

/** 导入前补齐能确定的字段；缺 vendorCode 且无法匹配主数据时返回 null（跳过该行） */
export function resolveFleetSupplierForImport(
  row: FleetSupplierImportRow,
  vendors?: FleetSupplierVendorLookup[],
): FleetSupplierImportRow | null {
  let vendorCode = row.vendorCode.trim()
  let vendorName = row.vendorName.trim()
  const supplierNickname = row.supplierNickname.trim()

  if (vendorCode && !vendorName && vendors?.length) {
    const hit = vendors.find((v) => normVendorKey(v.vendorCode) === normVendorKey(vendorCode))
    if (hit) vendorName = hit.vendorNameEn
  }

  if (!vendorCode && supplierNickname && vendors?.length) {
    const hit = lookupVendorByHint(supplierNickname, vendors)
    if (hit) {
      vendorCode = hit.vendorCode
      if (!vendorName) vendorName = hit.vendorNameEn
    }
  }

  if (!vendorCode || !supplierNickname) return null

  return {
    ...row,
    vendorCode,
    vendorName: vendorName || vendorCode,
    supplierNickname,
  }
}

export function partitionFleetSupplierImports(
  parsed: FleetSupplierImportRow[],
  vendors?: FleetSupplierVendorLookup[],
): { importable: FleetSupplierImportRow[]; skipped: number } {
  const importable: FleetSupplierImportRow[] = []
  let skipped = 0
  for (const row of parsed) {
    const resolved = resolveFleetSupplierForImport(row, vendors)
    if (resolved) importable.push(resolved)
    else skipped += 1
  }
  return { importable, skipped }
}

export function fleetSuppliersToExportRows(
  list: FleetSupplierConfig[],
  options: { includeSecrets: boolean },
): Record<string, string>[] {
  return list.map((s) => {
    const base: Record<string, string> = {
      id: s.id,
      vendorCode: s.vendorCode,
      vendorName: s.vendorName,
      supplierNickname: s.supplierNickname,
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
  | { ok: true; suppliers: FleetSupplierImportRow[]; parsedCount: number; skipped: number }
  | { ok: false; error: string }

function finalizeFleetSupplierImportParse(
  parsed: FleetSupplierImportRow[],
  options?: FleetSupplierImportOptions,
): FleetSupplierImportParseResult {
  if (!parsed.length) return { ok: false, error: '未解析到有效供应商记录' }
  const { importable, skipped } = partitionFleetSupplierImports(parsed, options?.vendors)
  if (!importable.length) {
    return {
      ok: false,
      error:
        skipped > 0
          ? `共解析 ${parsed.length} 条，均缺少 vendorCode（供应商编码）且无法从主数据匹配，请补列后重试`
          : '未解析到有效供应商记录',
    }
  }
  return { ok: true, suppliers: importable, parsedCount: parsed.length, skipped }
}

function parseJsonArray(text: string, options?: FleetSupplierImportOptions): FleetSupplierImportParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { ok: false, error: 'JSON 解析失败' }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'JSON 根节点须为数组' }
  }
  const out: FleetSupplierImportRow[] = []
  const gen = () => createFleetSupplierId()
  for (const item of parsed) {
    const s = sanitizeFleetSupplier(item, { generateId: gen })
    if (s) out.push(s)
  }
  return finalizeFleetSupplierImportParse(out, options)
}

function parseSheetRows(
  rows: Record<string, unknown>[],
  options?: FleetSupplierImportOptions,
): FleetSupplierImportParseResult {
  if (!rows.length) return { ok: false, error: '表格无数据行' }

  const out: FleetSupplierImportRow[] = []
  const gen = () => createFleetSupplierId()

  for (const raw of rows) {
    const mapped = fleetSupplierRowFromSheetRecord(raw)
    const normalized = {
      ...mapped,
      id: cellToStr(mapped.id),
      vendorCode: cellToStr(mapped.vendorCode),
      vendorName: cellToStr(mapped.vendorName),
      supplierNickname: cellToStr(mapped.supplierNickname),
      supplierName: cellToStr(mapped.supplierName),
      routeCode: cellToStr(mapped.routeCode),
      webhookUrl: cellToStr(mapped.webhookUrl),
      signingSecret: cellToStr(mapped.signingSecret),
      pushContent: cellToStr(mapped.pushContent),
    }
    if (
      !normalized.vendorCode
      && !normalized.supplierNickname
      && !normalized.supplierName
      && !normalized.routeCode
      && !normalized.webhookUrl
    ) {
      continue
    }
    const signingSecret =
      normalized.signingSecret.trim() !== '' ? normalized.signingSecret.trim() : undefined
    const s = sanitizeFleetSupplier(
      { ...normalized, signingSecret },
      { generateId: gen },
    )
    if (s) out.push(s)
  }

  return finalizeFleetSupplierImportParse(out, options)
}

function parseWorkbook(buf: ArrayBuffer, options?: FleetSupplierImportOptions): FleetSupplierImportParseResult {
  const wb = XLSX.read(buf, { type: 'array' })
  const name = wb.SheetNames[0]
  if (!name) return { ok: false, error: '表格为空' }
  const sheet = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return parseSheetRows(rows, options)
}

export async function parseFleetSuppliersImportFile(
  file: File,
  options?: FleetSupplierImportOptions,
): Promise<FleetSupplierImportParseResult> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.json') || file.type === 'application/json') {
    const text = await file.text()
    return parseJsonArray(text, options)
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer()
    return parseWorkbook(buf, options)
  }

  if (name.endsWith('.csv')) {
    const text = await file.text()
    const wb = XLSX.read(text, { type: 'string' })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) return { ok: false, error: 'CSV 无内容' }
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    return parseSheetRows(rows, options)
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
