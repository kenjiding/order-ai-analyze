/**
 * iMile 集包查询：ds.imile.com/lm/express/ops/v1/biz/bag/info/getBagInfo。
 * 按「集包创建时间」区间 + 责任站点拉全量集包，供「退返商家完结」页勾选提交。
 */

import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DC_RTC_PORTAL } from './portal'
import { envFirstOr, isRecord } from './shared'

const DEFAULT_BAG_INFO_URL = 'https://ds.imile.com/lm/express/ops/v1/biz/bag/info/getBagInfo'
const PAGE_SHOW_COUNT = 1000

export type BagInfoRow = {
  bagNumber: string
  /** 集包创建时间，原样透传 iMile 的字符串 */
  createDate: string
  /** 退返商家编码 */
  targetCode: string
  /** 集包订单数量 */
  waybillTotalCount: number
  /** 集包类型："退返商家" / "网点中转" */
  type: string
}

export type BagInfoResult =
  | { ok: true; rows: BagInfoRow[]; total: number }
  | { ok: false; status: number; message: string }

function toRow(raw: unknown): BagInfoRow | null {
  if (!isRecord(raw)) return null
  const bagNumber = String(raw.bagNumber ?? '').trim()
  if (!bagNumber) return null
  return {
    bagNumber,
    createDate: String(raw.createDate ?? '').trim(),
    targetCode: String(raw.targetCode ?? '').trim(),
    waybillTotalCount: Number(raw.waybillTotalCount ?? 0) || 0,
    type: String(raw.type ?? '').trim(),
  }
}

export async function fetchBagInfo(params: {
  imileToken: string
  /** 责任站点码，取自前端「站点选择器」 */
  ocCode: string
  /** 'YYYY-MM-DD HH:mm:ss' */
  startDate: string
  endDate: string
}): Promise<BagInfoResult> {
  // 门户头沿用退返商家（RTC）那套，IMILE_BAG_INFO_* 可单独勘误
  const headers = buildImilePortalHeaders({
    token: params.imileToken,
    envPrefix: 'IMILE_BAG_INFO',
    defaults: IMILE_DC_RTC_PORTAL,
    sharedEnvPrefixes: ['IMILE_RTC', 'IMILE_TRACK'],
    injectUserCode: true,
    overrides: { hubcode: params.ocCode },
  })
  const url = envFirstOr(['IMILE_BAG_INFO_URL'], DEFAULT_BAG_INFO_URL)

  const paged = await fetchPaginatedResultRows({
    label: '集包查询',
    pageShowCount: PAGE_SHOW_COUNT,
    requestPage: (body) =>
      requestImileApi({ url, method: 'POST', headers, body, label: '集包查询', retryBusy: true }),
    buildPageBody: ({ currentPage, showCount }) => ({
      bagNumber: [],
      currentPage,
      dateType: '',
      startDate: params.startDate,
      endDate: params.endDate,
      ocCode: params.ocCode,
      showCount,
    }),
  })

  if (!paged.ok) return { ok: false, status: paged.status, message: paged.message }

  const rows = paged.records.map(toRow).filter((row): row is BagInfoRow => row != null)
  return { ok: true, rows, total: paged.totalResult || rows.length }
}
