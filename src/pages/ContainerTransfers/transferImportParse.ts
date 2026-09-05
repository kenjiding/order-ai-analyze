/**
 * 流转记录批量导入：本地解析 + 逐行校验。
 *
 * 校验规则与手工表单 TransferFormModal 的 validateDraft 保持一致；两处都改时要一起改。
 * 一行的错误会全部收集（而不是遇到第一条就停），预览里一次性告诉用户要改哪些地方。
 */
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'
import {
  SELECTABLE_TRANSFER_KINDS,
  containerTypeLabel,
  transferKindLabel,
} from '../../containerManagement/constants'
import type { TransferCreateItem } from '../../containerManagement/api'
import type { ContainerAccount, ContainerType, TransferKind } from '../../containerManagement/types'
import {
  TRANSFER_IMPORT_GUIDE_SHEET,
  TRANSFER_IMPORT_MAX_ROWS,
  TRANSFER_IMPORT_REF_SHEET,
  TRANSFER_IMPORT_SHEET,
} from './transferImportTemplate'

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
  /** Excel 里的实际行号（表头是第 1 行） */
  rowNo: number
  raw: TransferImportRawRow
  /** 校验通过才有值 */
  item: TransferCreateItem | null
  errors: string[]
}

export type TransferImportParseResult =
  | { ok: true; rows: TransferImportRow[]; validCount: number; errorCount: number }
  | { ok: false; error: string }

export type TransferImportContext = {
  /** 全部站点账户，接收方的可选范围 */
  accounts: ContainerAccount[]
  /** 本人绑定的站点账户，转出方的可选范围；后端会再校验一次，这里只为在预览阶段就报出来 */
  fromAccounts: ContainerAccount[]
}

/** 表头别名：中文列名为主，兼容英文字段名，便于用户自己拼表 */
const COLUMN_ALIASES: Record<keyof TransferImportRawRow, string[]> = {
  occurredAt: ['日期', '时间', '发生日期', 'occurredAt', 'date'],
  kind: ['业务类型', '类型', 'kind'],
  from: ['转出方', '转出站点', 'fromAccount', 'from'],
  to: ['接收方', '接收站点', 'toAccount', 'to'],
  bigBasket: ['大蓝筐数量', '大蓝筐', '大篮筐数量', '大篮筐', 'bigBasket', 'BIG_BASKET'],
  silverBox: ['银筐数量', '银筐', '银框数量', '银框', 'silverBox', 'SILVER_BOX'],
  note: ['备注', '说明', 'note', 'remark'],
}

/** 缺了会直接判定「不是模板」的列 */
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

/** Excel 序列号 → 日期；1900 起算并跳过其虚构的 1900-02-29 */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null
  const date = dayjs('1899-12-30').add(Math.round(serial), 'day')
  return date.isValid() ? date.format('YYYY-MM-DD') : null
}

/**
 * 返回 'YYYY-MM-DD'；空值按后端 normalizeOccurredAt 的口径算作当天；无法识别返回 null。
 * 不用 dayjs 的格式化解析（customParseFormat 插件未全局注册），直接正则 + 回写比对，
 * 顺便挡掉 2026-13-01 这种「格式对但日期不存在」的输入。
 */
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

const KIND_BY_LABEL = new Map<string, TransferKind>(
  SELECTABLE_TRANSFER_KINDS.flatMap((kind) => [
    [normalizeName(transferKindLabel[kind]), kind] as const,
    [normalizeName(kind), kind] as const,
  ]),
)

const SELECTABLE_KIND_LABELS = SELECTABLE_TRANSFER_KINDS.map((kind) => transferKindLabel[kind])

function buildAccountMap(accounts: ContainerAccount[]): Map<string, ContainerAccount> {
  return new Map(accounts.map((account) => [normalizeName(account.name), account]))
}

/** 返回 null 表示留空（该行不含此品类），string 是错误信息 */
function parseQuantity(text: string, label: string): number | null | string {
  const value = text.trim()
  if (!value) return null
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity < 1) return `${label}必须是大于 0 的整数`
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

  const occurredAt = parseOccurredAt(rawOccurredAt, raw.occurredAt)
  if (!occurredAt) errors.push('日期格式不正确，应为 YYYY-MM-DD')

  const kind = KIND_BY_LABEL.get(normalizeName(raw.kind))
  if (!kind) {
    errors.push(
      raw.kind.trim()
        ? `业务类型「${raw.kind}」不合法，只能是${SELECTABLE_KIND_LABELS.map((l) => `「${l}」`).join('或')}`
        : '请填写业务类型',
    )
  }

  const fromAccount = fromAccountMap.get(normalizeName(raw.from))
  if (!fromAccount) {
    // 名字本身对得上、只是不归自己管，报「名字核对不上」会让人一直去查错别字
    const knownButNotMine = accountMap.get(normalizeName(raw.from))
    errors.push(
      !raw.from.trim()
        ? '请填写转出方'
        : knownButNotMine
          ? `转出方「${raw.from}」不是你绑定的站点，只能填模板「${TRANSFER_IMPORT_REF_SHEET}」表 A 列里的站点`
          : `转出方「${raw.from}」不在可选站点账户中，请对照模板「${TRANSFER_IMPORT_REF_SHEET}」表核对名字`,
    )
  }

  const toAccount = accountMap.get(normalizeName(raw.to))
  if (!toAccount) {
    errors.push(
      raw.to.trim()
        ? `接收方「${raw.to}」不在可选站点账户中，请对照模板「${TRANSFER_IMPORT_REF_SHEET}」表核对名字`
        : '请填写接收方',
    )
  }

  if (fromAccount && toAccount && fromAccount.id === toAccount.id) {
    errors.push('转出方与接收方不能相同')
  }

  const lineItems: { containerType: ContainerType; quantity: number }[] = []
  for (const [containerType, text] of [
    ['BIG_BASKET', raw.bigBasket],
    ['SILVER_BOX', raw.silverBox],
  ] as const) {
    const parsed = parseQuantity(text, `${containerTypeLabel[containerType]}数量`)
    if (typeof parsed === 'string') errors.push(parsed)
    else if (parsed !== null) lineItems.push({ containerType, quantity: parsed })
  }
  if (lineItems.length === 0 && !raw.bigBasket.trim() && !raw.silverBox.trim()) {
    errors.push('至少填写一个品类的数量')
  }

  const note = raw.note.trim()
  if (note.length > 2000) errors.push('备注过长（最多 2000 字）')

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
  if (workbook.Sheets[TRANSFER_IMPORT_SHEET]) return workbook.Sheets[TRANSFER_IMPORT_SHEET]
  const skip = new Set<string>([TRANSFER_IMPORT_REF_SHEET, TRANSFER_IMPORT_GUIDE_SHEET])
  const name = workbook.SheetNames.find((item) => !skip.has(item))
  return name ? workbook.Sheets[name] : null
}

function parseWorkbook(
  workbook: XLSX.WorkBook,
  ctx: TransferImportContext,
): TransferImportParseResult {
  const sheet = pickDataSheet(workbook)
  if (!sheet) return { ok: false, error: '表格为空' }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true })
  const headerRow = matrix[0]
  if (!headerRow) return { ok: false, error: '表格为空，请使用下载的模板填写' }

  const headers = headerRow.map((cell) => normalizeHeader(cell))
  const columnIndex = {} as Record<keyof TransferImportRawRow, number>
  for (const key of Object.keys(COLUMN_ALIASES) as (keyof TransferImportRawRow)[]) {
    const aliases = COLUMN_ALIASES[key].map((alias) => normalizeHeader(alias))
    columnIndex[key] = headers.findIndex((header) => header !== '' && aliases.includes(header))
  }
  const missing = REQUIRED_COLUMNS.filter((key) => columnIndex[key] < 0)
  if (missing.length > 0) {
    const names = missing.map((key) => `「${COLUMN_ALIASES[key][0]}」`).join('、')
    return { ok: false, error: `表头缺少${names}列，请使用下载的模板填写` }
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
    // 整行留空：用户在模板尾部留下的空行，跳过而不是报一堆错
    if (Object.values(raw).every((value) => value.trim() === '')) continue
    rows.push(validateRow(index + 1, raw, cell('occurredAt'), accountMap, fromAccountMap))
  }

  if (rows.length === 0) return { ok: false, error: '表格里没有数据行' }
  if (rows.length > TRANSFER_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      error: `单次最多导入 ${TRANSFER_IMPORT_MAX_ROWS} 行，当前 ${rows.length} 行，请拆分后分次上传`,
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
    return { ok: false, error: '文件解析失败，请确认是完整的 Excel/CSV 文件' }
  }
  return { ok: false, error: '不支持该文件类型，请使用 .xlsx / .xls / .csv' }
}

/**
 * 后端返回的「第 N 行」用的是 items 数组下标，跳过空行后与 Excel 里的行号并不一致。
 * 提交时按顺序把行号一起带上，报错时换回用户在表格里看到的那个行号。
 */
export function mapImportErrorRowNo(message: string, rowNos: number[]): string {
  return message.replace(/^第 (\d+) 行：/, (whole, index: string) => {
    const rowNo = rowNos[Number(index) - 1]
    return rowNo ? `第 ${rowNo} 行：` : whole
  })
}
