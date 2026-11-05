/**
 * 区域大盘清货数据推送专用的 iMile 取数：大区列表 + 派件统计 + 签收统计 + 仓内/仓外库存。
 * 定时任务无 HTTP 请求上下文，hubcode 统一用 overrides.hubcode = regionCode 显式传。
 *
 * 仓内库存（pending/delivery/query）的 host/resource-code/sys-portal/path/front-sec 已按
 * 2026-11-05 实际抓包结果勘误（原先沿用 ds.imile.com + saastms 通用门户配置是错的：host 应为
 * oc.imile.com，resource-code 是「TaskToBeDelivery」，sys-portal 是「OC」不是「DS」，且 front-sec
 * 必须带 userCode——这几项不对时 hubcode 请求头不会生效，接口会返回未按账号权限过滤的全量数据，
 * 表现为 resultObject.pagination.totalResult 固定一个很大的数、返回记录混着不相关的网点）。
 *
 * 以下几处字段/分页假设仍未经实测抓包确认：
 * - 签收统计（delivered/list）响应是否带 hubCode 字段、是否走 resultObject.pagination 分页包装
 */
import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import {
  buildImilePortalHeaders,
  IMILE_DS_SAAS_TMS_PORTAL,
  IMILE_OC_OFD_DELIVERED_PORTAL,
  IMILE_OC_PENDING_DELIVERY_PORTAL,
  IMILE_OC_REGION_LIST_PORTAL,
  type ImilePortalDefaults,
} from './portal'
import { envFirstOr, normalizeImileToken } from './shared'

const DEFAULT_REGION_LIST_URL = 'https://oc.imile.com/lm/express/base/v1/search/auth/permission/station'
const DEFAULT_OC_OFD_REPORT_URL = 'https://oc.imile.com/lm/express/ops/v1/biz/ofd/report/list'
const DEFAULT_OC_DELIVERED_LIST_URL = 'https://oc.imile.com/lm/express/ops/v1/biz/delivered/list'
const DEFAULT_PENDING_DELIVERY_URL = 'https://oc.imile.com/saastms/v1/ops/pending/delivery/query'
const DEFAULT_PENDING_DELIVERY_PAGE_PATH =
  'https://oc.imile.com/#/CenterMonitor/CenterOperationMonitor/TaskToBeDelivery'
const DEFAULT_OUTBOUND_STOCK_URL = 'https://ds.imile.com/saastms/v1/report/stock/daWaybillInventory'

const PAGE_SIZE = 1000
const PAGE_DELAY_MS = 300

export type RegionOption = { value: string; label: string }

export type RegionClearancePushError = { ok: false; status: number; message: string }
export type RegionClearancePushSuccess<T> = { ok: true; data: T }

/**
 * 这 5 个接口分属 oc.imile.com / ds.imile.com 两个 host，各自的 resource-code / sys-portal /
 * path / 是否需要 userCode 都不一样（见各 DEFAULT_*_URL 旁的 IMILE_*_PORTAL 配置、以及调用处的
 * options）——host 差异收在每个接口自己的 portal defaults 里，这里统一一个入口拼 header，
 * 不要在各 fetch 函数里各写一遍 buildImilePortalHeaders。
 */
function regionClearanceHeaders(
  token: string,
  regionCode: string,
  defaults: ImilePortalDefaults,
  options: {
    /** 大区列表接口本身就是查大区，不需要按 hubcode 收窄范围 */
    withHubcode?: boolean
    /** front-sec 要带账号 userCode 才会按权限过滤的接口传 true（如仓内库存，见文件顶部抓包勘误说明） */
    injectUserCode?: boolean
    sharedEnvPrefixes?: string[]
    extra?: Record<string, string>
  } = {},
): Record<string, string> {
  const { withHubcode = true, injectUserCode, sharedEnvPrefixes, extra } = options
  return buildImilePortalHeaders({
    token: normalizeImileToken(token),
    envPrefix: 'IMILE_REGION_CLEARANCE_PUSH',
    defaults,
    sharedEnvPrefixes,
    injectUserCode,
    overrides: withHubcode ? { hubcode: regionCode } : undefined,
    extra,
  })
}

/** 大区列表（permission/station，ocType=AC,RG）；不需要 hubcode override，用默认值即可 */
export async function fetchImileRegions(
  token: string,
): Promise<RegionClearancePushSuccess<RegionOption[]> | RegionClearancePushError> {
  const baseUrl = envFirstOr(['IMILE_REGION_LIST_URL'], DEFAULT_REGION_LIST_URL)
  const url = `${baseUrl}?status=ACTIVE&countries=AUS&ocType=AC,RG`
  const headers = regionClearanceHeaders(token, '', IMILE_OC_REGION_LIST_PORTAL, { withHubcode: false })

  const result = await requestImileApi({ url, method: 'GET', headers, label: '大区列表' })
  if (!result.ok) return { ok: false, status: result.status, message: result.message }

  const json = result.json as Record<string, unknown>
  const items = Array.isArray(json?.resultObject) ? (json.resultObject as Record<string, unknown>[]) : []
  const options = items
    .map((item) => ({ value: String(item.value ?? '').trim(), label: String(item.label ?? '').trim() }))
    .filter((o) => o.value)
  return { ok: true, data: options }
}

export type RegionReportParams = { token: string; regionCode: string; startTime: string; endTime: string }

/** 派件统计（ofd/report/list，按大区+日期区间） */
export async function fetchOfdReportByRegion(
  params: RegionReportParams,
): Promise<RegionClearancePushSuccess<unknown[]> | RegionClearancePushError> {
  const url = envFirstOr(['IMILE_OC_OFD_REPORT_URL'], DEFAULT_OC_OFD_REPORT_URL)
  const headers = regionClearanceHeaders(params.token, params.regionCode, IMILE_OC_OFD_DELIVERED_PORTAL)

  const result = await fetchPaginatedResultRows({
    label: '区域派件统计',
    pageShowCount: PAGE_SIZE,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) => ({
      changeDeliveryDaReason: '',
      currentPage,
      datasource: '',
      dtlCode: '',
      endTime: params.endTime,
      operatorCode: '',
      regionCodes: [params.regionCode],
      scanStationCode: '',
      showCount,
      startTime: params.startTime,
      waybillNos: [] as string[],
    }),
    requestPage: (body) => requestImileApi({ url, method: 'POST', headers, body, label: '区域派件统计' }),
  })
  if (!result.ok) return { ok: false, status: result.status, message: result.message }
  return { ok: true, data: result.records }
}

/** 签收统计（delivered/list，按大区+日期区间） */
export async function fetchDeliveredByRegion(
  params: RegionReportParams,
): Promise<RegionClearancePushSuccess<unknown[]> | RegionClearancePushError> {
  const url = envFirstOr(['IMILE_OC_DELIVERED_LIST_URL'], DEFAULT_OC_DELIVERED_LIST_URL)
  const headers = regionClearanceHeaders(params.token, params.regionCode, IMILE_OC_OFD_DELIVERED_PORTAL)

  const result = await fetchPaginatedResultRows({
    label: '区域签收统计',
    pageShowCount: PAGE_SIZE,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) => ({
      certificateId: '',
      consigneeTaxIdNo: '',
      currentPage,
      endTime: params.endTime,
      orderType: ['100'],
      regionCodes: [params.regionCode],
      showCount,
      startTime: params.startTime,
      waybillNos: [] as string[],
    }),
    requestPage: (body) => requestImileApi({ url, method: 'POST', headers, body, label: '区域签收统计' }),
  })
  if (!result.ok) return { ok: false, status: result.status, message: result.message }
  return { ok: true, data: result.records }
}

/**
 * 仓内库存（pending/delivery/query，页面「仓内监控/待派件任务」）；按大区 hubcode + 账号 userCode
 * 过滤，详见 IMILE_OC_PENDING_DELIVERY_PORTAL 与文件顶部的抓包勘误说明。
 */
export async function fetchPendingDeliveryInventory(
  params: { token: string; regionCode: string },
): Promise<RegionClearancePushSuccess<unknown[]> | RegionClearancePushError> {
  const url = envFirstOr(['IMILE_PENDING_DELIVERY_URL'], DEFAULT_PENDING_DELIVERY_URL)
  const pagePath = envFirstOr(['IMILE_PENDING_DELIVERY_PAGE_PATH'], DEFAULT_PENDING_DELIVERY_PAGE_PATH)
  const headers = regionClearanceHeaders(params.token, params.regionCode, IMILE_OC_PENDING_DELIVERY_PORTAL, {
    injectUserCode: true,
    sharedEnvPrefixes: ['IMILE_OFD_REPORT', 'IMILE_INBOUND', 'IMILE_TRACK'],
    extra: { 'x-page-path': pagePath },
  })

  const result = await fetchPaginatedResultRows({
    label: '仓内库存',
    pageShowCount: PAGE_SIZE,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) => ({
      clientCode: '',
      currentPage,
      isInLocation: '',
      orderType: '',
      queryFromDs: false,
      queryTab: 'all',
      showCount,
      waybillNoList: [] as string[],
    }),
    requestPage: (body) => requestImileApi({ url, method: 'POST', headers, body, label: '仓内库存' }),
  })
  if (!result.ok) return { ok: false, status: result.status, message: result.message }
  return { ok: true, data: result.records }
}

/** 仓外库存（daWaybillInventory，口径 allTotal，按大区 hubcode；hubcode 过滤实测有效，按全量分页拉取） */
export async function fetchOutboundStockInventory(
  params: { token: string; regionCode: string },
): Promise<RegionClearancePushSuccess<unknown[]> | RegionClearancePushError> {
  const url = envFirstOr(['IMILE_OUTBOUND_STOCK_URL'], DEFAULT_OUTBOUND_STOCK_URL)
  const headers = regionClearanceHeaders(params.token, params.regionCode, IMILE_DS_SAAS_TMS_PORTAL)

  const result = await fetchPaginatedResultRows({
    label: '仓外库存',
    pageShowCount: PAGE_SIZE,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) => ({
      country: 'AUS',
      currentPage,
      end: '',
      fromOc: true,
      ocCenterCode: 'S210206',
      orderTypes: [] as string[],
      scanType: '',
      scanTypeList: ['500'],
      showCount,
      start: '',
      stockReportType: 'allTotal',
      stockStationCodes: [] as string[],
    }),
    requestPage: (body) => requestImileApi({ url, method: 'POST', headers, body, label: '仓外库存' }),
  })
  if (!result.ok) return { ok: false, status: result.status, message: result.message }
  return { ok: true, data: result.records }
}
