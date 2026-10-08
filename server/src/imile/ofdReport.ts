/**
 * 滞留数据告警取数：到件 inbound/query 全量 + OFD 出仓报表（ofd/report/list）。
 *
 * iMile 繁忙后 searchWaybill 不能再用，改为：拿到件清单的单号去 OFD 报表里查，
 * 查得到 = 已有司机取货出仓（scanTime 即派件时间）；查不到 = 还没出仓。
 * 输出与 searchWaybill 同名字段的记录，下游 tagBefore11Rows / aggregateBefore11ByScopes 口径不变：
 * 已出仓单的路由码/供应商/商家取 OFD 报表；未出仓单没有承运商与派件时间，路由码/商家取到件扫描记录。
 */
import { requestImileApi } from './client'
import { fetchInboundRecords } from './inboundWaybillIndex'
import { buildImilePortalHeaders, IMILE_DC_SCAN_QUERY_PORTAL } from './portal'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { envFirstOr, isRecord, normalizeImileToken, sleep } from './shared'

const DEFAULT_OFD_REPORT_URL = 'https://ds.imile.com/lm/express/ops/v1/biz/ofd/report/list'
/** iMile 限制：单次最多 1000 单 */
const OFD_BATCH_SIZE = 1000
const OFD_BATCH_DELAY_MS = 300

/** OFD 报表单条（只取用到的字段） */
export type OfdReportRow = {
  waybillNo: string
  consigneeRouteCode: string
  driverVendorCode: string
  driverCode: string
  driverName: string
  clientCode: string
  /** 派件时间（iMile 墨尔本本地时间字符串） */
  scanTime: string
  /** 非失效出仓（isCancel≠1 且 isValidOfd≠0） */
  valid: boolean
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * OFD 原始行 → waybillNo 索引（只要有记录 = 司机取过货、出过仓）。
 * 同一单多条（派送失败后重派）时，iMile 会把旧的那次标成 isCancel=1 / isValidOfd=0——那次出仓真实发生过，
 * 不能丢（只剩失效记录的单仍算已出仓）；取「有效优先、其次最新」那条，与 searchWaybill 的当前承运商/派件时间一致。
 */
export function indexOfdRows(rows: unknown[], into = new Map<string, OfdReportRow>()): Map<string, OfdReportRow> {
  for (const row of rows) {
    if (!isRecord(row)) continue
    const waybillNo = str(row.waybillNo)
    if (!waybillNo) continue
    const valid = Number(row.isCancel) !== 1 && Number(row.isValidOfd) !== 0
    const scanTime = str(row.scanTime)
    const prev = into.get(waybillNo)
    if (prev && (prev.valid > valid || (prev.valid === valid && prev.scanTime >= scanTime))) continue
    into.set(waybillNo, {
      valid,
      waybillNo,
      consigneeRouteCode: str(row.consigneeRouteCode),
      driverVendorCode: str(row.driverVendorCode),
      driverCode: str(row.driverCode),
      driverName: str(row.driverName),
      clientCode: str(row.clientCode),
      scanTime,
    })
  }
  return into
}

/** 按单号批量查 OFD 报表；返回 waybillNo → 记录，查不到的单号不在 Map 里（= 未出仓） */
export async function fetchOfdReportByNos(input: {
  token: string
  stationCode: string
  waybillNos: string[]
  label: string
}): Promise<{ ok: true; data: Map<string, OfdReportRow> } | { ok: false; status: number; message: string }> {
  const url = envFirstOr(['IMILE_OFD_REPORT_URL'], DEFAULT_OFD_REPORT_URL)
  const headers = buildImilePortalHeaders({
    token: normalizeImileToken(input.token),
    envPrefix: 'IMILE_OFD_REPORT',
    defaults: IMILE_DC_SCAN_QUERY_PORTAL,
    sharedEnvPrefixes: ['IMILE_INBOUND', 'IMILE_TRACK'],
    injectUserCode: true,
    // 定时任务无 HTTP 请求上下文，hubcode 必须显式给
    overrides: { hubcode: input.stationCode },
  })

  const data = new Map<string, OfdReportRow>()
  for (let i = 0; i < input.waybillNos.length; i += OFD_BATCH_SIZE) {
    const batch = input.waybillNos.slice(i, i + OFD_BATCH_SIZE)
    // 接口分页且默认 showCount=10：不显式分页会只拿到前 10 条，其余全被误判成「未出仓」
    const res = await fetchPaginatedResultRows({
      label: input.label,
      pageShowCount: OFD_BATCH_SIZE,
      pageDelayMs: OFD_BATCH_DELAY_MS,
      // orderType 100 = 配送订单（司机派送）
      buildPageBody: ({ currentPage, showCount }) => ({ waybillNos: batch, orderType: ['100'], currentPage, showCount }),
      requestPage: (body) => requestImileApi({ url, method: 'POST', headers, body, label: input.label }),
    })
    if (!res.ok) return { ok: false, status: res.status, message: res.message }

    indexOfdRows(res.records, data)
    if (i + OFD_BATCH_SIZE < input.waybillNos.length) await sleep(OFD_BATCH_DELAY_MS)
  }
  return { ok: true, data }
}

/**
 * 到件记录 + OFD 命中 → searchWaybill 形状的记录（deliveryTime = OFD scanTime，未出仓为 null）。
 * 到件记录按 waybillNo 去重（同一单多次到件扫描只算一件）。
 */
export function buildExitAlarmWaybillRecords(
  inboundRows: unknown[],
  ofdByNo: Map<string, OfdReportRow>,
): Array<Record<string, unknown>> {
  const byNo = new Map<string, Record<string, unknown>>()
  for (const row of inboundRows) {
    if (!isRecord(row)) continue
    const waybillNo = str(row.waybillNo)
    if (!waybillNo || byNo.has(waybillNo)) continue
    const ofd = ofdByNo.get(waybillNo)
    byNo.set(waybillNo, {
      waybillNo,
      deliveryTime: ofd?.scanTime || null,
      courierCode: ofd?.driverCode ?? '',
      courierVendorCode: ofd?.driverVendorCode ?? '',
      courier: ofd?.driverName ?? '',
      consigneeRouteCode: ofd?.consigneeRouteCode || str(row.routeCode),
      clientCode: ofd?.clientCode || str(row.clientCode),
    })
  }
  return [...byNo.values()]
}

/** 滞留数据告警单个到件日取数：inbound 全量记录 → OFD 报表 → searchWaybill 形状记录 */
export async function fetchExitAlarmWaybillRecords(input: {
  token: string
  stationCode: string
  dateStr: string
  label: string
}): Promise<{ ok: true; records: Array<Record<string, unknown>> } | { ok: false; message: string }> {
  const inbound = await fetchInboundRecords({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    label: `${input.label} 到件`,
  })
  if (!inbound.ok) return inbound

  const nos = [...new Set(inbound.records.map((r) => (isRecord(r) ? str(r.waybillNo) : '')).filter(Boolean))]
  const ofd = await fetchOfdReportByNos({
    token: input.token,
    stationCode: input.stationCode,
    waybillNos: nos,
    label: `${input.label} OFD报表`,
  })
  if (!ofd.ok) return ofd

  console.log(`${input.label} 到件日 ${input.dateStr} 到件 ${nos.length} 单，已出仓 ${ofd.data.size} 单`)
  return { ok: true, records: buildExitAlarmWaybillRecords(inbound.records, ofd.data) }
}
