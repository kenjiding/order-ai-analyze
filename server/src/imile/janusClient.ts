/**
 * Janus 智能取数平台客户端：封装 sqlrest-gateway 网关调用。
 *
 * 数据源是数仓 ODS/ADS 表（约 4 小时同步一次批量刷新），不是业务库的实时查询——
 * 用于替代会被网关限流（429）的 searchWaybill 接口。接口本身不限流，文档建议
 * 单批最多 1000 个单号，批间无需退避重试，只需基本节流（见 JANUS_BATCH_DELAY_MS）。
 *
 * 鉴权用的就是系统里配置的那个 iMile token（Bearer），不是独立的 Janus 专属密钥——
 * 调用方要传当前有效的 iMile token 进来，不要在这里存一份静态快照，否则 iMile token
 * 一轮换这里就会跟着 401。
 */
import { sleep } from './shared'

const DEFAULT_JANUS_GATEWAY_URL = 'https://de-janus.imile-inc.com/sqlrest-gateway/api'
const JANUS_BATCH_SIZE = 1000
const JANUS_BATCH_DELAY_MS = 300

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

/** 按单号批量查 AUS 运单的商家信息，1000 单/批，批间等待 300ms。查不到的单号不在 Map 里 */
export async function fetchJanusAusWaybills(
  token: string,
  waybillNos: string[],
  label: string,
): Promise<{ ok: true; data: Map<string, JanusAusWaybillRow> } | JanusClientError> {
  const uniqueNos = [...new Set(waybillNos.map((no) => no.trim()).filter(Boolean))]
  const data = new Map<string, JanusAusWaybillRow>()
  if (uniqueNos.length === 0) return { ok: true, data }

  for (let i = 0; i < uniqueNos.length; i += JANUS_BATCH_SIZE) {
    const batch = uniqueNos.slice(i, i + JANUS_BATCH_SIZE)
    const res = await callJanusService<JanusAusWaybillRow>('ausops/waybillInfo/query', token, { waybillNos: batch }, label)
    if (!res.ok) return res
    for (const row of res.data) {
      if (row.waybill_no) data.set(row.waybill_no, row)
    }
    if (i + JANUS_BATCH_SIZE < uniqueNos.length) await sleep(JANUS_BATCH_DELAY_MS)
  }
  return { ok: true, data }
}
