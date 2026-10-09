/**
 * 滞留数据告警取数：到件 inbound/query 全量 + OFD 出仓报表（ofd/report/list）。
 *
 * iMile 繁忙后 searchWaybill 不能再用，改为：拿到件清单的单号去 OFD 报表里查，
 * 查得到 = 已有司机取货出仓（scanTime 即派件时间）；查不到 = 还没出仓。
 * 输出与 searchWaybill 同名字段的记录，下游 tagBefore11Rows / aggregateBefore11ByScopes 口径不变：
 * 已出仓单的路由码/供应商/商家取 OFD 报表；未出仓单没有承运商与派件时间，路由码/商家取到件扫描记录。
 *
 * 24H 派签告警同样走 OFD：scanTime = 派件时间，deliveredTime = 签收时间（与 delivered/list 的 scanTime 同值）；
 * 问题件时间/原因另走 problem/search（见 fetchDispatchWaybillDetails）。
 */
import { requestImileApi } from './client'
import { fetchInboundRecords, fetchInboundRecordsByNos } from './inboundWaybillIndex'
import { buildImilePortalHeaders, IMILE_DC_SCAN_QUERY_PORTAL, IMILE_DS_SAAS_TMS_PORTAL } from './portal'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { envFirstOr, isRecord, normalizeImileToken, sleep } from './shared'

const DEFAULT_OFD_REPORT_URL = 'https://ds.imile.com/lm/express/ops/v1/biz/ofd/report/list'
const DEFAULT_PROBLEM_SEARCH_URL = 'https://ds.imile.com/saastms/v1/biz/problem/search'
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
  /** 签收时间；未签收为空串 */
  deliveredTime: string
  consigneeZipCode: string
  /** 收件 suburb */
  consigneeCity: string
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
      deliveredTime: str(row.deliveredTime),
      consigneeZipCode: str(row.consigneeZipCode),
      consigneeCity: str(row.consigneeCity),
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

/**
 * 单号的最后一次问题件登记（同一单可多次上报，取 registerDate 最晚的一条）。
 * lastScanStationCode 是运单当前的最新扫描网点（运单级字段，与哪次登记无关）：错发件转运到外站后
 * 不是本站，24H 统计按站点过滤剔除——与原 searchWaybill 的 lastScanSiteCode 同口径。
 */
export type LastProblem = { registerDate: string; reason: string; lastScanStationCode: string }

/** 问题件原始行 → waybillNo 索引，取每单最晚一次登记 */
export function indexLastProblems(rows: unknown[], into = new Map<string, LastProblem>()): Map<string, LastProblem> {
  for (const row of rows) {
    if (!isRecord(row)) continue
    const waybillNo = str(row.waybillNo)
    const registerDate = str(row.registerDate)
    if (!waybillNo || !registerDate) continue
    const prev = into.get(waybillNo)
    if (prev && prev.registerDate >= registerDate) continue
    into.set(waybillNo, {
      registerDate,
      reason: str(row.problemReasonDesc) || str(row.problemReason),
      lastScanStationCode: str(row.lastScanStationCode),
    })
  }
  return into
}

/** 按单号批量查问题件登记（problem/search）；查不到 = 没报过问题件 */
export async function fetchLastProblemsByNos(input: {
  token: string
  stationCode: string
  waybillNos: string[]
  label: string
}): Promise<{ ok: true; data: Map<string, LastProblem> } | { ok: false; status: number; message: string }> {
  const url = envFirstOr(['IMILE_PROBLEM_SEARCH_URL'], DEFAULT_PROBLEM_SEARCH_URL)
  const headers = buildImilePortalHeaders({
    token: normalizeImileToken(input.token),
    envPrefix: 'IMILE_PROBLEM_SEARCH',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_VENDOR_LONG_TAIL', 'IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
    overrides: { hubcode: input.stationCode },
  })

  const data = new Map<string, LastProblem>()
  for (let i = 0; i < input.waybillNos.length; i += OFD_BATCH_SIZE) {
    const batch = input.waybillNos.slice(i, i + OFD_BATCH_SIZE)
    const res = await fetchPaginatedResultRows({
      label: input.label,
      pageShowCount: OFD_BATCH_SIZE,
      pageDelayMs: OFD_BATCH_DELAY_MS,
      // selectAll=false 时同一单只返回第一次登记，24H 要的是最后一次（判断是否属于本次派送），必须 true
      buildPageBody: ({ currentPage, showCount }) => ({
        currentPage,
        isBtw: '',
        selectAll: true,
        showCount,
        waybillNos: batch,
      }),
      requestPage: (body) => requestImileApi({ url, method: 'POST', headers, body, label: input.label }),
    })
    if (!res.ok) return { ok: false, status: res.status, message: res.message }

    indexLastProblems(res.records, data)
    if (i + OFD_BATCH_SIZE < input.waybillNos.length) await sleep(OFD_BATCH_DELAY_MS)
  }
  return { ok: true, data }
}

/**
 * OFD + 问题件 + 到件记录 → searchWaybill 形状的明细（字段名与 upsertStationDayWaybillRecords 读取的一致）。
 * 每个单号恰好一条：未出仓单没有承运商/派件/签收时间，路由码/商家/邮编取到件扫描记录。
 */
export function buildDispatchWaybillRecords(input: {
  waybillNos: string[]
  ofdByNo: Map<string, OfdReportRow>
  problemByNo: Map<string, LastProblem>
  inboundRows: unknown[]
}): Array<Record<string, unknown>> {
  const inboundByNo = new Map<string, Record<string, unknown>>()
  for (const row of input.inboundRows) {
    if (!isRecord(row)) continue
    const no = str(row.waybillNo)
    if (no && !inboundByNo.has(no)) inboundByNo.set(no, row)
  }
  return input.waybillNos.map((waybillNo) => {
    const ofd = input.ofdByNo.get(waybillNo)
    const inbound = inboundByNo.get(waybillNo)
    const problem = input.problemByNo.get(waybillNo)
    return {
      waybillNo,
      deliveryTime: ofd?.scanTime || null,
      signDate: ofd?.deliveredTime || null,
      courierCode: ofd?.driverCode ?? '',
      courierVendorCode: ofd?.driverVendorCode ?? '',
      courier: ofd?.driverName ?? '',
      consigneeRouteCode: ofd?.consigneeRouteCode || str(inbound?.routeCode),
      clientCode: ofd?.clientCode || str(inbound?.clientCode),
      consigneeZipCode: ofd?.consigneeZipCode || str(inbound?.consigneeZipCode),
      consigneeCity: ofd?.consigneeCity || str(inbound?.consigneeCity),
      lastProblemDate: problem?.registerDate || null,
      // 空串时落缓存默认本站（upsertStationDayWaybillRecords）；没报过问题件的单拿不到最新扫描网点
      lastScanSiteCode: problem?.lastScanStationCode ?? '',
      problemReason: problem?.reason ?? '',
    }
  })
}

/** 24H 派签明细取数（替代 searchWaybill）：OFD 报表 → 问题件 → 未出仓单补查到件记录 */
export async function fetchDispatchWaybillDetails(input: {
  token: string
  stationCode: string
  waybillNos: string[]
  label: string
}): Promise<{ ok: true; records: Array<Record<string, unknown>> } | { ok: false; status: number; message: string }> {
  const { token, stationCode, waybillNos, label } = input
  if (waybillNos.length === 0) return { ok: true, records: [] }

  const ofd = await fetchOfdReportByNos({ token, stationCode, waybillNos, label: `${label} OFD报表` })
  if (!ofd.ok) return ofd
  const problems = await fetchLastProblemsByNos({ token, stationCode, waybillNos, label: `${label} 问题件` })
  if (!problems.ok) return problems

  const notExited = waybillNos.filter((no) => !ofd.data.has(no))
  let inboundRows: unknown[] = []
  if (notExited.length > 0) {
    const inbound = await fetchInboundRecordsByNos({ token, stationCode, waybillNos: notExited, label: `${label} 未出仓到件` })
    if (!inbound.ok) return { ok: false, status: inbound.status ?? 502, message: inbound.message }
    inboundRows = inbound.records
  }

  console.log(
    `${label} 明细 ${waybillNos.length} 单：已出仓 ${ofd.data.size}，问题件 ${problems.data.size}，未出仓 ${notExited.length}`,
  )
  return { ok: true, records: buildDispatchWaybillRecords({ waybillNos, ofdByNo: ofd.data, problemByNo: problems.data, inboundRows }) }
}
