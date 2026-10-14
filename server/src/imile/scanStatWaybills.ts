/**
 * PDA 扫描统计：按运单号走 Janus 智能取数 AUS 运单查询（ausops/waybillInfo/query），取出商家编码。
 * 原先走中心运单查询（searchWaybill）会被网关限流（429），改走 Janus 单接口直查；
 * Janus 数仓按单号查，不需要 hubcode。
 *
 * Janus 的响应只有 client_code，没有商家名称，名称再用 track（轨迹查询）接口按运单号换——
 * 每个商家只挑一个代表运单号去查，调用量只随「不同商家数」增长，不随运单数增长，
 * 不会重新引入 searchWaybill 那种按全量运单查询被限流的问题。查名称失败不影响主流程，
 * 静默回退成只显示编码（见 resolveClientNames）。
 */
import { fetchJanusAusWaybills } from './janusClient'
import { queryImileTracks } from './track'

/** 单次查询单号上限，超出直接拒绝，不在 PDA 这条路上做分批。 */
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

/** 按商家分组的查询结果，拼成发给飞书接收人的文本消息。 */
export function buildScanStatSummaryText(stationName: string, groups: ScanStatGroup[]): string {
  const total = groups.reduce((sum, g) => sum + g.waybillNos.length, 0)
  const merchantCount = groups.filter((g) => g.kind === 'merchant').length
  const lines = [
    `${stationName ? `${stationName} ` : ''}查询商家（共 ${total} 单，${merchantCount} 个商家）：`,
    '',
  ]
  for (const g of groups) {
    const label = g.kind === 'merchant' && g.clientName !== g.clientCode ? `${g.clientCode} ${g.clientName}` : g.clientName || g.clientCode
    lines.push(`${label}（${g.waybillNos.length}）：${g.waybillNos.join('、')}`)
  }
  return lines.join('\n')
}

/** 按 clientCode 分组各挑一个代表运单号，用 track 接口换真实商家名称，原地填回 hits。 */
async function resolveClientNames(token: string, hits: ScanStatHit[]): Promise<void> {
  const representativeByCode = new Map<string, string>()
  for (const hit of hits) {
    if (hit.clientCode && !representativeByCode.has(hit.clientCode)) {
      representativeByCode.set(hit.clientCode, hit.waybillNo)
    }
  }
  if (representativeByCode.size === 0) return

  const result = await queryImileTracks(token, [...representativeByCode.values()])
  if (!result.ok) {
    console.error(`扫描统计查商家名称失败，回退为只显示编码: ${result.message}`)
    return
  }

  const nameByCode = new Map<string, string>()
  for (const [code, waybillNo] of representativeByCode) {
    const name = result.orderInfo[waybillNo]?.merchantName?.trim()
    if (name) nameByCode.set(code, name)
  }
  for (const hit of hits) {
    const name = nameByCode.get(hit.clientCode)
    if (name) hit.clientName = name
  }
}

export async function fetchScanStatWaybills(input: {
  token: string
  waybillNos: string[]
}): Promise<{ ok: true; hits: ScanStatHit[] } | ScanStatQueryError> {
  if (input.waybillNos.length === 0) return { ok: true, hits: [] }
  if (input.waybillNos.length > SCAN_STAT_MAX_WAYBILLS) {
    return { ok: false, status: 400, message: `单次最多查询 ${SCAN_STAT_MAX_WAYBILLS} 个运单号` }
  }

  const janus = await fetchJanusAusWaybills(input.token, input.waybillNos, '扫描统计运单查询')
  if (!janus.ok) return janus

  const hits: ScanStatHit[] = []
  for (const row of janus.data.values()) {
    hits.push({
      waybillNo: row.waybill_no,
      clientCode: (row.client_code ?? '').trim(),
      clientName: '',
    })
  }
  await resolveClientNames(input.token, hits)
  return { ok: true, hits }
}
