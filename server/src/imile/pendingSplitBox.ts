/**
 * iMile DS 待拆分箱查询（hub/operation/report/pd/box/pendingSplitBox）。
 * 「供应商内容推送」拉取入站数据的数据源：按 clientCode/city/consigneeZipCode/routeCode/waybillNo 落地为 FleetScanRow。
 */

import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DS_PENDING_SPLIT_BOX_PORTAL } from './portal'
import {
  envFirstOr,
  getRequestImileHubcode,
  IMILE_DEFAULT_HUBCODE,
  normalizeImileToken,
  resolveImileCountry,
} from './shared'

const DEFAULT_PENDING_SPLIT_BOX_URL =
  'https://ds.imile.com/hub/operation/report/pd/box/pendingSplitBox'

const PAGE_SHOW_COUNT = 1000
const PAGE_DELAY_MS = 400

export type PendingSplitBoxQuerySuccess = {
  ok: true
  records: unknown[]
  totalResult: number
  raw: unknown
}

export type PendingSplitBoxQueryError = {
  ok: false
  status: number
  message: string
  rawText?: string
}

function makePendingSplitBoxHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_PENDING_SPLIT_BOX',
    defaults: IMILE_DS_PENDING_SPLIT_BOX_PORTAL,
    sharedEnvPrefixes: ['IMILE_TRACK'],
    injectUserCode: true,
  })
}

function buildQueryBody(input: {
  country: string
  hubCode: string
  startTime: string
  endTime: string
  currentPage: number
  showCount: number
}): Record<string, unknown> {
  return {
    clientCodeList: [] as string[],
    country: input.country,
    currentPage: input.currentPage,
    deliveryHubCode: input.hubCode,
    endTime: input.endTime,
    isInLocation: '',
    ocCode: input.hubCode,
    routeCodeList: [] as string[],
    showCount: input.showCount,
    startTime: input.startTime,
  }
}

export async function queryImilePendingSplitBox(input: {
  imileToken: string
  startTime: string
  endTime: string
  country?: string
  hubCode?: string
}): Promise<PendingSplitBoxQuerySuccess | PendingSplitBoxQueryError> {
  const token = normalizeImileToken(input.imileToken)
  const url = envFirstOr(['IMILE_PENDING_SPLIT_BOX_URL'], DEFAULT_PENDING_SPLIT_BOX_URL)
  const headers = makePendingSplitBoxHeaders(token)

  const country = resolveImileCountry(input.country)
  // 跟随顶部「站点选择器」：优先取请求上下文 hubcode，其次显式传入值，最后兜底默认站点
  const hubCode =
    getRequestImileHubcode() ||
    input.hubCode?.trim() ||
    envFirstOr(['IMILE_PENDING_SPLIT_BOX_HUBCODE'], IMILE_DEFAULT_HUBCODE)

  const result = await fetchPaginatedResultRows({
    label: '待拆分箱查询',
    pageShowCount: PAGE_SHOW_COUNT,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) =>
      buildQueryBody({
        country,
        hubCode,
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
        label: '待拆分箱查询',
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
