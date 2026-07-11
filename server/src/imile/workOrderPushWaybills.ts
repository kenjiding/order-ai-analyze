/**
 * 工单推送：按 waybillNo 批量查询运单供应商归属。
 * 工单本身的 currentHandleCode/responsibleDeptCode 是内部处理部门/责任人代码，
 * 未处理工单常常还没分配处理人，字段可能为空；courierVendorCode 才是稳定的承运供应商归属，
 * 用来决定该工单该催促哪个供应商处理。
 */

import { requestImileApi } from './client'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DS_SAAS_TMS_PORTAL } from './portal'
import { envFirstOr, isRecord, normalizeImileToken, sleep } from './shared'

const DEFAULT_SEARCH_WAYBILL_URL = 'https://ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'

/** iMile 硬限制：单次查询单号不超过 1000 条 */
const WAYBILL_QUERY_BATCH_SIZE = 1000
const WAYBILL_PAGE_SHOW_COUNT = 1000
const WAYBILL_PAGE_DELAY_MS = 300
const WAYBILL_BATCH_DELAY_MS = 300

export type WorkOrderPushWaybillError = { ok: false; status: number; message: string }
export type WorkOrderPushWaybillSuccess = { ok: true; data: Map<string, string> }

function makeWaybillHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_WORK_ORDER_PUSH_WAYBILL',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_CANCEL_SCAN', 'IMILE_VENDOR_WAYBILL', 'IMILE_TRACK'],
  })
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** 查询窗口足够宽，覆盖任意历史工单关联运单的下单日期，不依赖工单自身创建时间 */
function wideSearchWindow(): { startTime: string; endTime: string } {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const endDate = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  return { startTime: '2018-01-01 00:00:00', endTime: `${endDate} 23:59:59` }
}

/**
 * 按 waybillNo 批量查询 searchWaybill，只提取供应商代码（courierVendorCode）。
 * 返回 waybillNo -> courierVendorCode 映射；查不到的单号不出现在结果里。
 */
export async function fetchWorkOrderWaybillVendors(
  token: string,
  waybillNos: string[],
): Promise<WorkOrderPushWaybillSuccess | WorkOrderPushWaybillError> {
  const uniqueNos = [...new Set(waybillNos.filter((no) => typeof no === 'string' && no.trim().length > 0))]
  const result = new Map<string, string>()
  if (uniqueNos.length === 0) return { ok: true, data: result }

  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_WORK_ORDER_PUSH_WAYBILL_URL'], DEFAULT_SEARCH_WAYBILL_URL)
  const headers = makeWaybillHeaders(normalizedToken)
  const { startTime, endTime } = wideSearchWindow()
  const batches = chunkArray(uniqueNos, WAYBILL_QUERY_BATCH_SIZE)

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]
    const pageResult = await fetchPaginatedResultRows({
      label: '工单关联运单供应商查询',
      pageShowCount: WAYBILL_PAGE_SHOW_COUNT,
      pageDelayMs: WAYBILL_PAGE_DELAY_MS,
      buildPageBody: ({ currentPage, showCount }) => ({
        actualReceiveStation: '',
        currentPage,
        dateSearchType: 'waybill',
        startTime,
        endTime,
        labelOrderCodes: [] as string[],
        mainWaybillNos: [] as string[],
        platformNos: [] as string[],
        referenceNos: [] as string[],
        showCount,
        waybillNos: batch,
      }),
      requestPage: (body) =>
        requestImileApi({ url, method: 'POST', headers, body, label: '工单关联运单供应商查询' }),
    })

    if (!pageResult.ok) return { ok: false, status: pageResult.status, message: pageResult.message }

    for (const row of pageResult.records) {
      if (!isRecord(row)) continue
      const waybillNo = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
      const courierVendorCode = typeof row.courierVendorCode === 'string' ? row.courierVendorCode.trim() : ''
      if (waybillNo && courierVendorCode) result.set(waybillNo, courierVendorCode)
    }

    if (i < batches.length - 1) await sleep(WAYBILL_BATCH_DELAY_MS)
  }

  return { ok: true, data: result }
}
