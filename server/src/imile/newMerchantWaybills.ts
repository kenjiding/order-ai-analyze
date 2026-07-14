/**
 * 新商家运单监控：按 clientCodes + firstCountry 时间范围一次性拉取全量运单，前端做指标聚合。
 */

import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DS_SAAS_TMS_PORTAL } from './portal'
import { envFirstOr, IMILE_DEFAULT_HUBCODE, normalizeImileToken } from './shared'

const DEFAULT_SEARCH_WAYBILL_URL =
  'https://ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'

const WAYBILL_PAGE_SHOW_COUNT = 500
const PAGE_DELAY_MS = 400

export type NewMerchantWaybillsSuccess = {
  ok: true
  records: unknown[]
  totalResult: number
  raw: unknown
}

export type NewMerchantWaybillsError = {
  ok: false
  status: number
  message: string
  rawText?: string
}

function makeSaasTmsHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_NEW_MERCHANT',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
    injectUserCode: true,
    // 新商户运单查询固定 hubcode，不受站点选择器覆盖
    overrides: { hubcode: IMILE_DEFAULT_HUBCODE },
  })
}

function buildSearchWaybillBody(input: {
  clientCodes: string[]
  startTime: string
  endTime: string
  currentPage: number
  showCount: number
}): Record<string, unknown> {
  return {
    actualReceiveStation: '',
    clientCodes: input.clientCodes,
    currentPage: input.currentPage,
    dateSearchType: 'firstCountry',
    endTime: input.endTime,
    labelOrderCodes: [] as string[],
    mainWaybillNos: [] as string[],
    platformNos: [] as string[],
    referenceNos: [] as string[],
    showCount: input.showCount,
    startTime: input.startTime,
    waybillNos: [] as string[],
  }
}

export async function fetchNewMerchantWaybills(input: {
  imileToken: string
  clientCodes: string[]
  startTime: string
  endTime: string
}): Promise<NewMerchantWaybillsSuccess | NewMerchantWaybillsError> {
  const token = normalizeImileToken(input.imileToken)
  const url = envFirstOr(['IMILE_SEARCH_WAYBILL_URL'], DEFAULT_SEARCH_WAYBILL_URL)
  const headers = makeSaasTmsHeaders(token)

  const result = await fetchPaginatedResultRows({
    label: '新商家运单查询',
    pageShowCount: WAYBILL_PAGE_SHOW_COUNT,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) =>
      buildSearchWaybillBody({
        clientCodes: input.clientCodes,
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
        label: '新商家运单查询',
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
