/**
 * 滞留数据告警（11点前出仓告警）与 24H 派签告警共用的取数：
 * 到件 inbound/query 全量 + OFD 出仓报表（ofd/report/list）+ 签收查询（delivered/query）+ 问题件（problem/search）。
 *
 * iMile 繁忙后 searchWaybill 不能再用，改为：拿到件清单的单号去这几个报表接口里查，
 * 查得到 OFD = 已有司机取货出仓（scanTime 即派件时间）；查不到 = 还没出仓。
 * 输出与 searchWaybill 同名字段的记录：
 * 已出仓单的路由码/供应商/商家取 OFD 报表；未出仓单没有承运商与派件时间，路由码/商家取到件扫描记录。
 *
 * 24H 派签明细原先走 Janus 智能取数单接口直查，但 Janus 数仓约小时级同步，推送時效跟不上，
 * 现改回 OFD 报表 + delivered/query（签收时效更好）+ problem/search 三接口拼，见 inboundWaybillIndex.ts
 * 的 fetchDispatchWaybillDetailsViaReports。
 */
import { requestImileApi } from './client'
import { fetchInboundRecords } from './inboundWaybillIndex'
import {
  buildImilePortalHeaders,
  IMILE_DC_SCAN_QUERY_PORTAL,
  IMILE_DELIVERED_QUERY_PORTAL,
  IMILE_DS_SAAS_TMS_PORTAL,
} from './portal'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { envFirstOr, isRecord, normalizeImileToken, sleep } from './shared'

const DEFAULT_OFD_REPORT_URL = 'https://ds.imile.com/lm/express/ops/v1/biz/ofd/report/list'
const DEFAULT_PROBLEM_SEARCH_URL = 'https://ds.imile.com/saastms/v1/biz/problem/search'
const DEFAULT_DELIVERED_QUERY_URL = 'https://ds.imile.com/dms/migrate/report/delivered/query'
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
 * 签收查询单条（delivered/query，只取用到的字段）。
 * 实测抓包确认：响应字段是 deliveredDate/daCode/daName/routeCode，不是文档示例里的
 * deliveredTime/driverCode/driverName；接口本身不返回承运商编码（只有 daVendorName/vendorShortName
 * 两个「名称」字段，没有 code），courierVendorCode 仍只能靠 OFD 报表的 driverVendorCode。
 */
export type DeliveredQueryRow = {
  deliveredDate: string
  daCode: string
  daName: string
  clientCode: string
  routeCode: string
}

/**
 * delivered/query 原始行 → waybillNo 索引，取每单最晚一次签收记录（同一单可能有补登记/线下补录
 * 等多条记录，见响应里的 offlineDeliveredDate/hasDeliveredReason 字段）；查不到 = 还没签收。
 * 与 indexOfdRows/indexLastProblems 同口径，都要「取最新那条」而不是数组里随便一条。
 */
export function indexDeliveredRows(
  rows: unknown[],
  into = new Map<string, DeliveredQueryRow>(),
): Map<string, DeliveredQueryRow> {
  for (const row of rows) {
    if (!isRecord(row)) continue
    const waybillNo = str(row.waybillNo)
    const deliveredDate = str(row.deliveredDate)
    if (!waybillNo || !deliveredDate) continue
    const prev = into.get(waybillNo)
    if (prev && prev.deliveredDate >= deliveredDate) continue
    into.set(waybillNo, {
      deliveredDate,
      daCode: str(row.daCode),
      daName: str(row.daName),
      clientCode: str(row.clientCode),
      routeCode: str(row.routeCode),
    })
  }
  return into
}

/**
 * 按单号批量查签收情况（delivered/query）；比 Janus 数仓时效更好（Janus 约小时级同步），
 * 24H 派签告警的 signDate 改用这个接口。查不到 = 还没签收。
 *
 * 实测确认：请求字段是 waybillNoList（不是文档示例的 waybillNos，那个字段名不生效、
 * 接口会退化成按 deliveredStartTime/deliveredEndTime 查全站全部签收记录）；
 * 传 waybillNoList 时不需要再带日期范围，否则没传日期会报「时间范围最大允许选择31天」。
 */
export async function fetchDeliveredByNos(input: {
  token: string
  stationCode: string
  waybillNos: string[]
  label: string
}): Promise<{ ok: true; data: Map<string, DeliveredQueryRow> } | { ok: false; status: number; message: string }> {
  const url = envFirstOr(['IMILE_DELIVERED_QUERY_URL'], DEFAULT_DELIVERED_QUERY_URL)
  const headers = buildImilePortalHeaders({
    token: normalizeImileToken(input.token),
    envPrefix: 'IMILE_DELIVERED_QUERY',
    defaults: IMILE_DELIVERED_QUERY_PORTAL,
    sharedEnvPrefixes: ['IMILE_VENDOR_LONG_TAIL', 'IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
    overrides: { hubcode: input.stationCode },
  })

  const data = new Map<string, DeliveredQueryRow>()
  for (let i = 0; i < input.waybillNos.length; i += OFD_BATCH_SIZE) {
    const batch = input.waybillNos.slice(i, i + OFD_BATCH_SIZE)
    const res = await fetchPaginatedResultRows({
      label: input.label,
      pageShowCount: OFD_BATCH_SIZE,
      pageDelayMs: OFD_BATCH_DELAY_MS,
      buildPageBody: ({ currentPage, showCount }) => ({
        certificateId: '',
        consigneeTaxIdNo: '',
        currentPage,
        showCount,
        waybillNoList: batch,
      }),
      requestPage: (body) => requestImileApi({ url, method: 'POST', headers, body, label: input.label }),
    })
    if (!res.ok) return { ok: false, status: res.status, message: res.message }

    indexDeliveredRows(res.records, data)
    if (i + OFD_BATCH_SIZE < input.waybillNos.length) await sleep(OFD_BATCH_DELAY_MS)
  }
  return { ok: true, data }
}

