/**
 * 优先客户批量导入：浏览器端解析表格，按商家编码去重。
 * 编码列识别「商家编码 / Client Code」或 parent_client_code；名称列同理。
 */
import * as XLSX from 'xlsx'

export type ImportedClient = { clientCode: string; clientName: string }

export type PriorityImportResult =
  | { ok: true; clients: ImportedClient[]; total: number; duplicates: number; invalid: number }
  | { ok: false; error: string }

export const PRIORITY_IMPORT_MAX_ROWS = 5000

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/[\s_\-./]/g, '')
    .toLowerCase()
}

const isCodeHeader = (h: string) => ['clientcode', '商家编码', '客户编码'].some((k) => h.includes(k))
const isNameHeader = (h: string) => ['clientname', '商家名称', '客户名称'].some((k) => h.includes(k))

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\uFEFF/g, '').trim()
}

/** 解析已转成二维数组的表格内容 */
export function parsePriorityClientMatrix(matrix: unknown[][]): PriorityImportResult {
  const headerRow = matrix.find((line) =>
    line.some((cell) => isCodeHeader(normalizeHeader(cell))),
  )
  if (!headerRow) return { ok: false, error: 'missingCodeColumn' }
  const headers = headerRow.map((cell) => normalizeHeader(cell))
  const codeAt = headers.findIndex(isCodeHeader)
  const nameAt = headers.findIndex(isNameHeader)

  const body = matrix.slice(matrix.indexOf(headerRow) + 1)
  const seen = new Set<string>()
  const clients: ImportedClient[] = []
  let duplicates = 0
  let invalid = 0
  let total = 0

  for (const line of body) {
    const clientCode = cellToText(line[codeAt])
    const clientName = nameAt < 0 ? '' : cellToText(line[nameAt])
    if (!clientCode && !clientName) continue
    total += 1
    if (!clientCode || clientCode.length > 64) {
      invalid += 1
      continue
    }
    const key = clientCode.toUpperCase()
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    // 名称缺失时退回用编码占位，避免整行被后端的必填校验挡掉
    clients.push({ clientCode, clientName: (clientName || clientCode).slice(0, 255) })
  }

  if (clients.length === 0) return { ok: false, error: 'noValidRows' }
  if (clients.length > PRIORITY_IMPORT_MAX_ROWS) return { ok: false, error: 'tooManyRows' }
  return { ok: true, clients, total, duplicates, invalid }
}

export async function parsePriorityClientFile(file: File): Promise<PriorityImportResult> {
  const name = file.name.toLowerCase()
  try {
    const workbook = name.endsWith('.csv')
      ? XLSX.read(await file.text(), { type: 'string' })
      : name.endsWith('.xlsx') || name.endsWith('.xls')
        ? XLSX.read(await file.arrayBuffer(), { type: 'array' })
        : null
    if (!workbook) return { ok: false, error: 'unsupportedType' }
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    if (!sheet) return { ok: false, error: 'emptySheet' }
    return parsePriorityClientMatrix(
      XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false }),
    )
  } catch (error) {
    console.error('[priority-clients-import] 解析失败', error)
    return { ok: false, error: 'parseFailed' }
  }
}
