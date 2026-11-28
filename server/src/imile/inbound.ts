/**
 * iMile 到件扫描查询（ds.imile.com/lm/express/report/v1/biz/inbound/query）。
 * 请求头与控制台「扫描查询 / ScanQuery」对齐，见 portal.IMILE_DC_SCAN_QUERY_PORTAL。
 */

import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DC_SCAN_QUERY_PORTAL } from './portal'
import { readResultPagination, readResultRows } from './resultObject'
import { envFirstOr, normalizeImileToken } from './shared'

const DEFAULT_INBOUND_URL = 'https://ds.imile.com/lm/express/report/v1/biz/inbound/query'

const INBOUND_QUERY_DEFAULTS = {
  isLatest: 1,
  orderScopeNew: '',
  receiveType: 'All',
  scanTypeList: ['100', '300', '2500', '600'],
  searchNoList: [] as string[],
  vehicleUuid: '',
}

// iMile inbound/query 硬限制：showCount 超过 1000 直接业务报错「最多显示1,000条数据」
// （inboundWaybillIndex.ts 对同一接口已验证过这个上限，这里保持一致）
const PAGE_SHOW_COUNT = 1000
const PAGE_DELAY_MS = 400

export type InboundQuerySuccess = {
  ok: true
  records: unknown[]
  totalResult: number
  raw: unknown
}

export type InboundQueryError = {
  ok: false
  status: number
  message: string
  rawText?: string
}

function makeInboundHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_INBOUND',
    defaults: IMILE_DC_SCAN_QUERY_PORTAL,
    sharedEnvPrefixes: ['IMILE_TRACK'],
    injectUserCode: true,
  })
}

function buildQueryBody(input: {
  startTime: string
  endTime: string
  currentPage: number
  showCount: number
}): Record<string, unknown> {
  return {
    ...INBOUND_QUERY_DEFAULTS,
    startTime: input.startTime,
    endTime: input.endTime,
    currentPage: input.currentPage,
    showCount: input.showCount,
  }
}

export async function queryImileInboundScans(input: {
  imileToken: string
  startTime: string
  endTime: string
}): Promise<InboundQuerySuccess | InboundQueryError> {
  const token = normalizeImileToken(input.imileToken)
  const url = envFirstOr(['IMILE_INBOUND_URL'], DEFAULT_INBOUND_URL)
  const headers = makeInboundHeaders(token)

  const result = await fetchPaginatedResultRows({
    label: '到件查询',
    pageShowCount: PAGE_SHOW_COUNT,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) =>
      buildQueryBody({
        startTime: input.startTime,
        endTime: input.endTime,
        currentPage,
        showCount,
      }),
    requestPage: (body) =>
      requestImileApi({
        url,
        method: 'POST',
        headers,
        body,
        label: '到件查询',
      }),
  })

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      message: result.message,
      rawText: result.rawText,
    }
  }

  return {
    ok: true,
    records: result.records,
    totalResult: result.totalResult,
    raw: result.raw,
  }
}

export type InboundQueryPageSuccess = {
  ok: true
  records: unknown[]
  totalResult: number
  currentPage: number
  totalPages: number
  raw: unknown
}

/**
 * 只拉一页，把分页循环交给调用方（前端）控制，这样前端才能在每页返回后更新真实进度；
 * 而 queryImileInboundScans 内部循环所有页，调用方（其它路由）拿到的是一次性结果，看不到中间进度。
 */
export async function queryImileInboundScansPage(input: {
  imileToken: string
  startTime: string
  endTime: string
  currentPage: number
}): Promise<InboundQueryPageSuccess | InboundQueryError> {
  const token = normalizeImileToken(input.imileToken)
  const url = envFirstOr(['IMILE_INBOUND_URL'], DEFAULT_INBOUND_URL)
  const headers = makeInboundHeaders(token)

  const res = await requestImileApi({
    url,
    method: 'POST',
    headers,
    body: buildQueryBody({
      startTime: input.startTime,
      endTime: input.endTime,
      currentPage: input.currentPage,
      showCount: PAGE_SHOW_COUNT,
    }),
    label: '到件查询',
  })

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: res.message,
      rawText: res.rawText,
    }
  }

  const { totalResult } = readResultPagination(res.json)
  const totalPages = totalResult > 0 ? Math.max(1, Math.ceil(totalResult / PAGE_SHOW_COUNT)) : 1

  return {
    ok: true,
    records: readResultRows(res.json),
    totalResult,
    currentPage: input.currentPage,
    totalPages,
    raw: res.json,
  }
}
