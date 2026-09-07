/**
 * 流转记录批量导入：本地解析 + 逐行校验。
 */
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'
import { SELECTABLE_TRANSFER_KINDS } from '../../containerManagement/constants'
import type { TransferCreateItem } from '../../containerManagement/api'
import type { ContainerAccount, ContainerType, TransferKind } from '../../containerManagement/types'
import { i18n } from '../../i18n'
import {
  TRANSFER_IMPORT_MAX_ROWS,
  transferImportGuideSheetName,
  transferImportHeaders,
  transferImportRefSheetName,
  transferImportSheetName,
} from './transferImportTemplate'

const ns = 'container'

function tt(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns, ...options })
}

export type TransferImportRawRow = {
  occurredAt: string
  kind: string
  from: string
  to: string
  bigBasket: string
  silverBox: string
  note: string
}

export type TransferImportRow = {
  rowNo: number
  raw: TransferImportRawRow
  item: TransferCreateItem | null
  errors: string[]
}

export type TransferImportParseResult =
  | { ok: true; rows: TransferImportRow[]; validCount: number; errorCount: number }
  | { ok: false; error: string }

export type TransferImportContext = {
  accounts: ContainerAccount[]
  fromAccounts: ContainerAccount[]
}

function columnAliases(): Record<keyof TransferImportRawRow, string[]> {
  const h = transferImportHeaders()
  return {
    occurredAt: ['日期', '时间', '发生日期', 'occurredAt', 'date', h[0]],
    kind: ['业务类型', '类型', 'kind', h[1]],
    from: ['转出方', '转出站点', 'fromAccount', 'from', h[2]],
    to: ['接收方', '接收站点', 'toAccount', 'to', h[3]],
    bigBasket: ['大蓝筐数量', '大蓝筐', '大篮筐数量', '大篮筐', 'bigBasket', 'BIG_BASKET', h[4]],
    silverBox: ['银筐数量', '银筐', '银框数量', '银框', 'silverBox', 'SILVER_BOX', h[5]],
    note: ['备注', '说明', 'note', 'remark', h[6]],
  }
}

const REQUIRED_COLUMNS: (keyof TransferImportRawRow)[] = ['kind', 'from', 'to']

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, '')
    .replace(/[.:：．。*＊]+$/u, '')
    .trim()
    .toLowerCase()
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return dayjs(value).format('YYYY-MM-DD')
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value)
  }
  return String(value).replace(/\uFEFF/g, '').trim()
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null
  const date = dayjs('1899-12-30').add(Math.round(serial), 'day')
  return date.isValid() ? date.format('YYYY-MM-DD') : null
}

function parseOccurredAt(raw: unknown, text: string): string | null {
  if (raw instanceof Date) {
    const d = dayjs(raw)
    return d.isValid() ? d.format('YYYY-MM-DD') : null
  }
  if (typeof raw === 'number') return excelSerialToIso(raw)
  const value = text.trim()
  if (!value) return dayjs().format('YYYY-MM-DD')
  if (/^\d{4,5}$/.test(value)) return excelSerialToIso(Number(value))
  const normalized = value
    .replace(/[./\u5e74\u6708]/g, '-')
    .replace(/\u65e5$/u, '')
    .replace(/-+$/, '')
  const matched = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized)
  if (!matched) return null
  const [, y, m, day] = matched.map(Number)
  const d = dayjs(new Date(y, m - 1, day))
  if (!d.isValid() || d.year() !== y || d.month() + 1 !== m || d.date() !== day) return null
  return d.format('YYYY-MM-DD')
}

function buildKindByLabel(): Map<string, TransferKind> {
  const map = new Map<string, TransferKind>()
  for (const kind of SELECTABLE_TRANSFER_KINDS) {
    map.set(normalizeName(kind), kind)
    for (const lng of ['zh-CN', 'en'] as const) {
      map.set(normalizeName(i18n.t(`transferKind.${kind}`, { lng, ns })), kind)
    }
  }
  return map
}

function selectableKindLabels(): string[] {
  return SELECTABLE_TRANSFER_KINDS.map((kind) => tt(`transferKind.${kind}`))
}

function buildAccountMap(accounts: ContainerAccount[]): Map<string, ContainerAccount> {
  return new Map(accounts.map((account) => [normalizeName(account.name), account]))
}

function parseQuantity(text: string, label: string): number | null | string {
  const value = text.trim()
  if (!value) return null
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity < 1) return tt('importParse.errQtyInt', { label })
  return quantity
}

function validateRow(
  rowNo: number,
  raw: TransferImportRawRow,
  rawOccurredAt: unknown,
  accountMap: Map<string, ContainerAccount>,
  fromAccountMap: Map<string, ContainerAccount>,
): TransferImportRow {
  const errors: string[] = []
  const refSheet = transferImportRefSheetName()
  const kindByLabel = buildKindByLabel()
  const kindLabels = selectableKindLabels()

  const occurredAt = parseOccurredAt(rawOccurredAt, raw.occurredAt)
  if (!occurredAt) errors.push(tt('importParse.errInvalidDate'))

  const kind = kindByLabel.get(normalizeName(raw.kind))
  if (!kind) {
    const options = i18n.language.startsWith('zh')
      ? kindLabels.map((l) => `「${l}」`).join('或')
      : kindLabels.join(' or ')
    errors.push(
      raw.kind.trim()
        ? tt('importParse.errInvalidKind', { value: raw.kind, options })
        : tt('importParse.errKindRequired'),
    )
  }

  const fromAccount = fromAccountMap.get(normalizeName(raw.from))
  if (!fromAccount) {
    const knownButNotMine = accountMap.get(normalizeName(raw.from))
    errors.push(
      !raw.from.trim()
        ? tt('importParse.errFromRequired')
        : knownButNotMine
          ? tt('importParse.errFromNotMine', { name: raw.from, refSheet })
          : tt('importParse.errFromUnknown', { name: raw.from, refSheet }),
    )
  }

  const toAccount = accountMap.get(normalizeName(raw.to))
  if (!toAccount) {
    errors.push(
      raw.to.trim()
        ? tt('importParse.errToUnknown', { name: raw.to, refSheet })
        : tt('importParse.errToRequired'),
    )
  }

  if (fromAccount && toAccount && fromAccount.id === toAccount.id) {
    errors.push(tt('importParse.errSameAccount'))
  }

  const lineItems: { containerType: ContainerType; quantity: number }[] = []
  for (const [containerType, text] of [
    ['BIG_BASKET', raw.bigBasket],
    ['SILVER_BOX', raw.silverBox],
  ] as const) {
    const label = `${tt(`containerType.${containerType}`)}${tt('importParse.qtyLabelSuffix')}`
    const parsed = parseQuantity(text, label)
    if (typeof parsed === 'string') errors.push(parsed)
    else if (parsed !== null) lineItems.push({ containerType, quantity: parsed })
  }
  if (lineItems.length === 0 && !raw.bigBasket.trim() && !raw.silverBox.trim()) {
    errors.push(tt('importParse.errMinOneType'))
  }

  const note = raw.note.trim()
  if (note.length > 2000) errors.push(tt('importParse.errNoteTooLong'))

  const item: TransferCreateItem | null =
    errors.length === 0 && kind && fromAccount && toAccount && occurredAt
      ? {
          kind,
          fromAccountId: fromAccount.id,
          toAccountId: toAccount.id,
          lineItems,
          occurredAt,
          note: note || null,
        }
      : null

  return { rowNo, raw, item, errors }
}

function pickDataSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | null {
  const dataSheet = transferImportSheetName()
  if (workbook.Sheets[dataSheet]) return workbook.Sheets[dataSheet]
  const skip = new Set([transferImportRefSheetName(), transferImportGuideSheetName()])
  const name = workbook.SheetNames.find((item) => !skip.has(item))
  return name ? workbook.Sheets[name] : null
}

function parseWorkbook(
  workbook: XLSX.WorkBook,
  ctx: TransferImportContext,
): TransferImportParseResult {
  const sheet = pickDataSheet(workbook)
  if (!sheet) return { ok: false, error: tt('importParse.errEmptySheet') }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true })
  const headerRow = matrix[0]
  if (!headerRow) return { ok: false, error: tt('importParse.errEmptyUseTemplate') }

  const aliases = columnAliases()
  const headers = headerRow.map((cell) => normalizeHeader(cell))
  const columnIndex = {} as Record<keyof TransferImportRawRow, number>
  for (const key of Object.keys(aliases) as (keyof TransferImportRawRow)[]) {
    const keyAliases = aliases[key].map((alias) => normalizeHeader(alias))
    columnIndex[key] = headers.findIndex((header) => header !== '' && keyAliases.includes(header))
  }
  const missing = REQUIRED_COLUMNS.filter((key) => columnIndex[key] < 0)
  if (missing.length > 0) {
    const names = missing.map((key) => `「${aliases[key][0]}」`).join('、')
    return { ok: false, error: tt('importParse.errMissingColumns', { columns: names }) }
  }

  const accountMap = buildAccountMap(ctx.accounts)
  const fromAccountMap = buildAccountMap(ctx.fromAccounts)

  const rows: TransferImportRow[] = []
  for (let index = 1; index < matrix.length; index += 1) {
    const line = matrix[index] ?? []
    const cell = (key: keyof TransferImportRawRow): unknown => {
      const at = columnIndex[key]
      return at < 0 ? '' : line[at]
    }
    const raw: TransferImportRawRow = {
      occurredAt: cellToText(cell('occurredAt')),
      kind: cellToText(cell('kind')),
      from: cellToText(cell('from')),
      to: cellToText(cell('to')),
      bigBasket: cellToText(cell('bigBasket')),
      silverBox: cellToText(cell('silverBox')),
      note: cellToText(cell('note')),
    }
    if (Object.values(raw).every((value) => value.trim() === '')) continue
    rows.push(validateRow(index + 1, raw, cell('occurredAt'), accountMap, fromAccountMap))
  }

  if (rows.length === 0) return { ok: false, error: tt('importParse.errNoDataRows') }
  if (rows.length > TRANSFER_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      error: tt('importParse.errTooManyRows', { max: TRANSFER_IMPORT_MAX_ROWS, count: rows.length }),
    }
  }

  const errorCount = rows.filter((row) => row.errors.length > 0).length
  return { ok: true, rows, validCount: rows.length - errorCount, errorCount }
}

export async function parseTransferImportFile(
  file: File,
  ctx: TransferImportContext,
): Promise<TransferImportParseResult> {
  const name = file.name.toLowerCase()
  try {
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const buf = await file.arrayBuffer()
      return parseWorkbook(XLSX.read(buf, { type: 'array', cellDates: true }), ctx)
    }
    if (name.endsWith('.csv')) {
      const text = await file.text()
      return parseWorkbook(XLSX.read(text, { type: 'string', cellDates: true }), ctx)
    }
  } catch (error) {
    console.error('[container-transfer-import] 解析失败', error)
    return { ok: false, error: tt('importParse.errParseFailed') }
  }
  return { ok: false, error: tt('importParse.errUnsupportedType') }
}

export function mapImportErrorRowNo(message: string, rowNos: number[]): string {
  return message.replace(/^第 (\d+) 行：|^Row (\d+): /, (whole, zhIndex: string, enIndex: string) => {
    const index = zhIndex ?? enIndex
    const rowNo = rowNos[Number(index) - 1]
    return rowNo ? tt('importParse.errRowPrefix', { row: rowNo }) : whole
  })
}
