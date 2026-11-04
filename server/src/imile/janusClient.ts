/**
 * Janus 智能取数平台客户端：封装 sqlrest-gateway 网关调用。
 *
 * 数据源是数仓 ODS/ADS 表（约 4 小时同步一次批量刷新），不是业务库的实时查询——
 * 用于替代会被网关限流（429）的 searchWaybill 接口。
 *
 * **JANUS_BATCH_SIZE 必须 <= 1000，这是正确性要求，不是性能可调项**：实测发现
 * `resultObject` 单次最多只返回 1000 行，查询条数超过 1000 时命中数会被悄悄截断到 1000
 * （用假单号测批量接受度看不出这个问题——假单号永远查不到数据，不会触发这个 1000 行的返回上限；
 * 只有用真实命中的单号测才会发现：前 1000 个单号 100% 命中，第 1001 个开始命中数不再增长）。
 * 一旦单批发的单号数超过 1000，只要该批里真实匹配数超过 1000，多出来的会被静默丢弃，
 * 绝不能为了"减少请求次数"把这个值调大，哪怕接口本身对请求体大小/数量没有报错。
 *
 * 鉴权用的就是系统里配置的那个 iMile token（Bearer），不是独立的 Janus 专属密钥——
 * 调用方要传当前有效的 iMile token 进来，不要在这里存一份静态快照，否则 iMile token
 * 一轮换这里就会跟着 401。
 *
 * 批次之间允许并发：Janus 网关本身不限流（不会 429），批次互相独立、顺序无关，之前串行
 * +300ms 节流纯粹是没必要的保守写法。改成 JANUS_CONCURRENCY 个批次同时在飞，iMile 的
 * inbound/query 索引那段仍保持串行（见 inboundWaybillIndex.ts 头部注释，那边是另一套接口，
 * 会被网关限流，不能照搬这里的并发）。
 */
import { mapWithConcurrency } from '../orderAnalyze/runtime'

const DEFAULT_JANUS_GATEWAY_URL = 'https://de-janus.imile-inc.com/sqlrest-gateway/api'
const JANUS_BATCH_SIZE = 1000
const JANUS_CONCURRENCY = 20

export type JanusClientError = { ok: false; status: number; message: string }

function janusGatewayUrl(path: string): string {
  const base = process.env.JANUS_GATEWAY_URL?.trim() || DEFAULT_JANUS_GATEWAY_URL
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

async function callJanusService<T>(
  path: string,
  token: string,
  body: Record<string, unknown>,
  label: string,
): Promise<{ ok: true; data: T[] } | JanusClientError> {
  const res = await fetch(janusGatewayUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()

  let json: { status?: string; resultObject?: T[]; message?: string }
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, status: res.status, message: `${label} Janus 返回非 JSON：${text.slice(0, 300)}` }
  }
  if (json.status !== 'success') {
    return { ok: false, status: res.status, message: `${label} Janus 失败：${json.message ?? '未知错误'}` }
  }
  return { ok: true, data: json.resultObject ?? [] }
}

/**
 * AUS 运单查询（ausops/waybillInfo/query）原始响应行，取 PDA 扫描统计用到的商家字段，
 * 以及包裹重量统计用到的三个重量字段。
 */
export type JanusAusWaybillRow = {
  waybill_no: string
  client_code?: string
  consignee_route_code?: string
  dispatch_vendor_code?: string
  dispatch_vender_name?: string
  total_weight?: number | string | null
  order_detail_total_weight?: number | string | null
  upload_weight?: number | string | null
}

function toFiniteWeight(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 可信重量取值优先级：实测 180 单样本，total_weight 覆盖率 100% 且与
 * order_detail_total_weight 逐单完全相等（同一数据源的冗余字段），upload_weight
 * （称重设备/人工上传）在抽样站点全部为空，只作兜底占位，不能指望它提供覆盖率。
 */
export function resolveTrustedWeight(row: JanusAusWaybillRow): number | null {
  return (
    toFiniteWeight(row.total_weight) ??
    toFiniteWeight(row.order_detail_total_weight) ??
    toFiniteWeight(row.upload_weight)
  )
}

/** 按单号批量查 AUS 运单的商家信息，1000 单/批，最多 20 批同时在飞。查不到的单号不在 Map 里 */
export async function fetchJanusAusWaybills(
  token: string,
  waybillNos: string[],
  label: string,
): Promise<{ ok: true; data: Map<string, JanusAusWaybillRow> } | JanusClientError> {
  const uniqueNos = [...new Set(waybillNos.map((no) => no.trim()).filter(Boolean))]
  const data = new Map<string, JanusAusWaybillRow>()
  if (uniqueNos.length === 0) return { ok: true, data }

  const batches: string[][] = []
  for (let i = 0; i < uniqueNos.length; i += JANUS_BATCH_SIZE) {
    batches.push(uniqueNos.slice(i, i + JANUS_BATCH_SIZE))
  }

  const results = await mapWithConcurrency(batches, JANUS_CONCURRENCY, (batch) =>
    callJanusService<JanusAusWaybillRow>('ausops/waybillInfo/query', token, { waybillNos: batch }, label),
  )

  const failed = results.find((r): r is JanusClientError => !r.ok)
  if (failed) return failed

  for (const r of results) {
    if (!r.ok) continue
    for (const row of r.data) {
      if (row.waybill_no) data.set(row.waybill_no, row)
    }
  }
  return { ok: true, data }
}
