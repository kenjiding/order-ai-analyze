/**
 * PDA 扫描统计：按运单号走中心运单查询（searchWaybill），取出商家编码。
 * hubcode 必须是所选站点，否则接口成功但 results 为空。
 */
import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DS_SAAS_TMS_PORTAL } from './portal'
import { envFirstOr, isRecord, normalizeImileToken } from './shared'

const DEFAULT_SEARCH_WAYBILL_URL = 'https://ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'
const PAGE_SHOW_COUNT = 1000
const PAGE_DELAY_MS = 300

/** iMile 单次查询单号上限。超出直接拒绝，不在 PDA 这条路上做分批。 */
export const SCAN_STAT_MAX_WAYBILLS = 1000

export type ScanStatHit = {
  waybillNo: string
  clientCode: string
  clientName: string
}

export type ScanStatGroup = {
  kind: 'merchant' | 'unknown' | 'unmatched'
  clientCode: string
  clientName: string
  waybillNos: string[]
}

export type ScanStatQueryError = { ok: false; status: number; message: string }

function wideSearchWindow(): { startTime: string; endTime: string } {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const endDate = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  return { startTime: '2018-01-01 00:00:00', endTime: `${endDate} 23:59:59` }
}

export function normalizeScanWaybillNos(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const nos: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const no = item.trim()
    if (!no || seen.has(no)) continue
    seen.add(no)
    nos.push(no)
  }
  return nos
}

/** 扫描顺序保留在组内；商家按件数降序，未识别、未查到排在后面。 */
export function groupScanStatWaybills(scannedNos: string[], hits: ScanStatHit[]): ScanStatGroup[] {
  const byNo = new Map<string, ScanStatHit>()
  for (const hit of hits) {
    const no = hit.waybillNo.trim()
    if (!no || byNo.has(no)) continue
    byNo.set(no, {
      waybillNo: no,
      clientCode: hit.clientCode.trim(),
      clientName: hit.clientName.trim(),
    })
  }

  const buckets = new Map<string, ScanStatGroup>()
  const seen = new Set<string>()
  for (const raw of scannedNos) {
    const no = raw.trim()
    if (!no || seen.has(no)) continue
    seen.add(no)
    const hit = byNo.get(no)
    const key = !hit ? '\0unmatched' : hit.clientCode ? hit.clientCode.toUpperCase() : '\0unknown'
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = !hit
        ? { kind: 'unmatched', clientCode: '', clientName: '未查到', waybillNos: [] }
        : hit.clientCode
          ? {
              kind: 'merchant',
              clientCode: hit.clientCode,
              clientName: hit.clientName || hit.clientCode,
              waybillNos: [],
            }
          : { kind: 'unknown', clientCode: '', clientName: '未识别商家', waybillNos: [] }
      buckets.set(key, bucket)
    } else if (bucket.kind === 'merchant' && hit?.clientName && bucket.clientName === bucket.clientCode) {
      bucket.clientName = hit.clientName
    }
    bucket.waybillNos.push(no)
  }

  return [...buckets.values()].sort((a, b) => {
    const rank = (g: ScanStatGroup) => (g.kind === 'merchant' ? 0 : g.kind === 'unknown' ? 1 : 2)
    return rank(a) - rank(b) || b.waybillNos.length - a.waybillNos.length || a.clientCode.localeCompare(b.clientCode)
  })
}

function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function crc32(data: Buffer): number {
  let c = ~0
  for (let i = 0; i < data.length; i += 1) {
    c ^= data[i]!
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** 无压缩 ZIP。只给这份 xlsx 用，Excel / 飞书都能打开。 */
function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const crc = crc32(file.data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(file.data.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, file.data)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(file.data.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length + file.data.length
  }
  const centralDir = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDir, eocd])
}

function sheetCell(col: string, row: number, value: string): string {
  return `<c r="${col}${row}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`
}

/** 一行一个运单：商家编码、商家名称、运单号。 */
export function buildScanStatXlsx(groups: ScanStatGroup[]): Buffer {
  const rows = ['<row r="1">' + sheetCell('A', 1, '商家编码') + sheetCell('B', 1, '商家名称') + sheetCell('C', 1, '运单号') + '</row>']
  let row = 2
  for (const group of groups) {
    const code = group.kind === 'merchant' ? group.clientCode : ''
    const name =
      group.kind === 'merchant'
        ? group.clientName !== group.clientCode
          ? group.clientName
          : ''
        : group.clientName
    for (const waybillNo of group.waybillNos) {
      rows.push(`<row r="${row}">${sheetCell('A', row, code)}${sheetCell('B', row, name)}${sheetCell('C', row, waybillNo)}</row>`)
      row += 1
    }
  }
  const sheet = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="3" width="24" customWidth="1"/></cols>
<sheetData>${rows.join('')}</sheetData>
</worksheet>`,
  )
  return zipStore([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="扫描统计" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ])
}

export async function fetchScanStatWaybills(input: {
  token: string
  stationCode: string
  waybillNos: string[]
}): Promise<{ ok: true; hits: ScanStatHit[] } | ScanStatQueryError> {
  if (input.waybillNos.length === 0) return { ok: true, hits: [] }
  if (input.waybillNos.length > SCAN_STAT_MAX_WAYBILLS) {
    return { ok: false, status: 400, message: `单次最多查询 ${SCAN_STAT_MAX_WAYBILLS} 个运单号` }
  }

  const headers = buildImilePortalHeaders({
    token: normalizeImileToken(input.token),
    envPrefix: 'IMILE_SCAN_STAT_WAYBILL',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_VENDOR_DS_WAYBILL', 'IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
    overrides: { hubcode: input.stationCode },
  })
  const url = envFirstOr(['IMILE_SCAN_STAT_WAYBILL_URL'], DEFAULT_SEARCH_WAYBILL_URL)
  const { startTime, endTime } = wideSearchWindow()
  const pageResult = await fetchPaginatedResultRows({
    label: '扫描统计运单查询',
    pageShowCount: PAGE_SHOW_COUNT,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) => ({
      actualReceiveStation: '',
      currentPage,
      dateSearchType: 'waybill',
      startTime,
      endTime,
      labelOrderCodes: [] as string[],
      mainWaybillNos: [] as string[],
      platformNos: [] as string[],
      referenceNos: [] as string[],
      showCount,
      waybillNos: input.waybillNos,
    }),
    requestPage: (body) =>
      requestImileApi({ url, method: 'POST', headers, body, label: '扫描统计运单查询' }),
  })
  if (!pageResult.ok) return { ok: false, status: pageResult.status, message: pageResult.message }

  const hits: ScanStatHit[] = []
  for (const row of pageResult.records) {
    if (!isRecord(row)) continue
    const waybillNo = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
    if (!waybillNo) continue
    const clientCode = typeof row.clientCode === 'string' ? row.clientCode.trim() : ''
    const clientName = typeof row.clientName === 'string' ? row.clientName.trim() : ''
    hits.push({ waybillNo, clientCode, clientName })
  }
  return { ok: true, hits }
}
