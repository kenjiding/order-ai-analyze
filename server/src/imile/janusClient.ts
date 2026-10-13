/**
 * Janus 智能取数平台客户端：封装 sqlrest-gateway 网关调用。
 *
 * 数据源是数仓 ODS/ADS 表（约 4 小时同步一次批量刷新），不是业务库的实时查询——
 * 用于替代会被网关限流（429）的 searchWaybill 等接口。接口本身不限流，文档建议
 * 单批最多 1000 个单号，批间无需退避重试，只需基本节流（见 JANUS_BATCH_DELAY_MS）。
 */
import { envFirst, sleep } from './shared'

const DEFAULT_JANUS_GATEWAY_URL = 'https://de-janus.imile-inc.com/sqlrest-gateway/api'
const JANUS_BATCH_SIZE = 1000
const JANUS_BATCH_DELAY_MS = 300

export type JanusClientError = { ok: false; status: number; message: string }

function janusGatewayUrl(path: string): string {
  const base = envFirst('JANUS_GATEWAY_URL') ?? DEFAULT_JANUS_GATEWAY_URL
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function janusToken(): string {
  const token = envFirst('JANUS_API_TOKEN')
  if (!token) throw new Error('缺少环境变量 JANUS_API_TOKEN，无法调用 Janus 接口')
  return token
}

/** 调用 Janus 网关上的某个取数服务；path 为服务路径（如 'ausops/waybillInfo/query'，不含 /api 前缀） */
async function callJanusService<T>(
  path: string,
  body: Record<string, unknown>,
  label: string,
): Promise<{ ok: true; data: T[] } | JanusClientError> {
  const res = await fetch(janusGatewayUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${janusToken()}` },
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

/** 按 waybillNos 分批查询 Janus 服务，1000 单/批，批间等待 300ms */
async function queryJanusBatched<T>(
  path: string,
  waybillNos: string[],
  label: string,
): Promise<{ ok: true; rows: T[] } | JanusClientError> {
  const uniqueNos = [...new Set(waybillNos.filter((no) => no.trim().length > 0))]
  if (uniqueNos.length === 0) return { ok: true, rows: [] }

  const rows: T[] = []
  for (let i = 0; i < uniqueNos.length; i += JANUS_BATCH_SIZE) {
    const batch = uniqueNos.slice(i, i + JANUS_BATCH_SIZE)
    const res = await callJanusService<T>(path, { waybillNos: batch }, label)
    if (!res.ok) return res
    rows.push(...res.data)
    if (i + JANUS_BATCH_SIZE < uniqueNos.length) await sleep(JANUS_BATCH_DELAY_MS)
  }
  return { ok: true, rows }
}

/** AUS 运单查询（Janus 服务编码 query，/ausops/waybillInfo/query）原始响应行 */
export type JanusAusWaybillRow = {
  waybill_no: string
  consignee_route_code?: string
  client_code?: string
  last_problem_date?: string
  courier_code?: string
  consignee_zip_code?: string
  consignee_province?: string
  consignee_city?: string
  courier?: string
  first_ds_arrive_date?: string
  actual_receive_station_name?: string
  receive_date?: string
  /** 首次派件时间候选 */
  first_delivery_date?: string
  /** 最新派件时间候选 */
  last_delivery_date?: string
  dispatch_user_time?: string
  /** 签收时间候选 */
  delivered_date?: string
  dispatch_vendor_code?: string
  dispatch_vendor_name?: string
  tz_first_country_time?: string
  total_weight?: number
  order_detail_total_weight?: number
  upload_weight?: string
  dispatch_station?: string
  last_scan_site?: string
  send_site?: string
  first_scan_oc_name?: string
  last_scan_type?: string
  /** 问题件类型编码（非文案），无问题件为空字符串 */
  problem_info_problem_type?: string
}

/** 按单号批量查 AUS 运单；返回 waybillNo → 原始行，查不到的单号不在 Map 里 */
export async function fetchJanusAusWaybills(
  waybillNos: string[],
  label: string,
): Promise<{ ok: true; data: Map<string, JanusAusWaybillRow> } | JanusClientError> {
  const res = await queryJanusBatched<JanusAusWaybillRow>('ausops/waybillInfo/query', waybillNos, label)
  if (!res.ok) return res
  const data = new Map<string, JanusAusWaybillRow>()
  for (const row of res.rows) {
    if (row.waybill_no) data.set(row.waybill_no, row)
  }
  return { ok: true, data }
}
