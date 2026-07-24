/**
 * iMile DS 前台箱号分配列表（hub/operation/report/pd/box/assignedList）。
 */

import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DS_BOX_ASSIGNED_PORTAL } from './portal'
import { envFirstOr, IMILE_DEFAULT_HUBCODE, normalizeImileToken, resolveImileCountry } from './shared'

const DEFAULT_ASSIGNED_LIST_URL =
  'https://ds.imile.com/hub/operation/report/pd/box/assignedList'

const PAGE_SHOW_COUNT = 1000
const PAGE_DELAY_MS = 400

export type BoxAssignedListQuerySuccess = {
  ok: true
  records: unknown[]
  totalResult: number
  raw: unknown
}

export type BoxAssignedListQueryError = {
  ok: false
  status: number
  message: string
  rawText?: string
}

function makeAssignedListHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_BOX_ASSIGNED',
    defaults: IMILE_DS_BOX_ASSIGNED_PORTAL,
    sharedEnvPrefixes: ['IMILE_TRACK'],
    injectUserCode: true,
  })
}

function buildQueryBody(input: {
  country: string
  pendingHubCode: string
  pendingHubName: string
  startTime: string
  endTime: string
  currentPage: number
  showCount: number
}): Record<string, unknown> {
  return {
    country: input.country,
    currentPage: input.currentPage,
    driverCode: '',
    endTime: input.endTime,
    pendingHubCode: input.pendingHubCode,
    pendingHubName: input.pendingHubName,
    searchNumbers: [] as string[],
    searchType: 'routeCode',
    showCount: input.showCount,
    startTime: input.startTime,
  }
}

export async function queryImileBoxAssignedList(input: {
  imileToken: string
  startTime: string
  endTime: string
  country?: string
  pendingHubCode?: string
  pendingHubName?: string
}): Promise<BoxAssignedListQuerySuccess | BoxAssignedListQueryError> {
  const token = normalizeImileToken(input.imileToken)
  const url = envFirstOr(['IMILE_BOX_ASSIGNED_URL'], DEFAULT_ASSIGNED_LIST_URL)
  const headers = makeAssignedListHeaders(token)

  const country = resolveImileCountry(input.country)
  const pendingHubCode =
    input.pendingHubCode?.trim() ||
    envFirstOr(['IMILE_BOX_ASSIGNED_PENDING_HUB_CODE'], IMILE_DEFAULT_HUBCODE)
  const pendingHubName =
    input.pendingHubName?.trim() ||
    envFirstOr(['IMILE_BOX_ASSIGNED_PENDING_HUB_NAME'], '')

  const result = await fetchPaginatedResultRows({
    label: '前台箱号分配',
    pageShowCount: PAGE_SHOW_COUNT,
    pageDelayMs: PAGE_DELAY_MS,
    buildPageBody: ({ currentPage, showCount }) =>
      buildQueryBody({
        country,
        pendingHubCode,
        pendingHubName,
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
        label: '前台箱号分配',
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
