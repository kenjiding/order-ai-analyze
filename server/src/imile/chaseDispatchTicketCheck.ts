/**
 * 催派"≥7 天"推送前置过滤：按运单号查询是否已有关联工单（如起诉罚款），
 * 已有工单说明该单已被处理，飞书推送中不再重复展示。
 */

import { requestImileApi } from './client'
import { buildImilePortalHeaders, IMILE_DS_TICKET_PORTAL } from './portal'
import { envFirstOr, normalizeImileToken, sleep } from './shared'
import { mapWithConcurrency } from '../orderAnalyze/runtime'

const DEFAULT_TICKET_QUERY_URL = 'https://ds.imile.com/ticket/biz/work/order/ticketQuery'
const TICKET_QUERY_SHOW_COUNT = 999
const TICKET_QUERY_CONCURRENCY = 3
const TICKET_QUERY_DELAY_MS = 200

function makeTicketQueryHeaders(token: string, hubcode: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_CHASE_DISPATCH_TICKET',
    defaults: IMILE_DS_TICKET_PORTAL,
    sharedEnvPrefixes: ['IMILE_STAGNANT_WAYBILL', 'IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
    // hubcode 必须与催派滞留单查询的站点一致；定时任务无 HTTP 请求上下文，
    // 不能依赖 getRequestImileHubcode() 兜底，需由调用方显式传入该 schedule 的 stationCode
    overrides: { hubcode },
  })
}

async function waybillHasExistingTicket(
  headers: Record<string, string>,
  url: string,
  waybillNo: string,
): Promise<{ ok: true; hasTicket: boolean } | { ok: false; message: string }> {
  const body = {
    currentPage: 1,
    searchType: 'waybill',
    searchValue: waybillNo,
    showCount: TICKET_QUERY_SHOW_COUNT,
  }
  const result = await requestImileApi({ url, method: 'POST', headers, body, label: '催派工单关联查询' })
  if (!result.ok) return { ok: false, message: result.message }

  const json = result.json as Record<string, unknown>
  const obj = json?.resultObject as Record<string, unknown> | null | undefined
  const results = Array.isArray(obj?.results) ? obj.results : []
  return { ok: true, hasTicket: results.length > 0 }
}

/**
 * 逐单查询 ticketQuery，返回已有关联工单的运单号集合。
 * 单次查询失败时保留该单（宁可重复提醒，不可漏发），仅打日志不中断整体推送。
 */
export async function filterWaybillsWithExistingTicket(
  token: string,
  waybillNos: string[],
  hubcode: string,
  label: string,
): Promise<Set<string>> {
  const uniqueNos = [...new Set(waybillNos.map((no) => no.trim()).filter(Boolean))]
  const ticketed = new Set<string>()
  if (uniqueNos.length === 0) return ticketed

  const normalizedToken = normalizeImileToken(token)
  const url = envFirstOr(['IMILE_CHASE_DISPATCH_TICKET_URL'], DEFAULT_TICKET_QUERY_URL)
  const headers = makeTicketQueryHeaders(normalizedToken, hubcode)

  await mapWithConcurrency(uniqueNos, TICKET_QUERY_CONCURRENCY, async (waybillNo) => {
    const res = await waybillHasExistingTicket(headers, url, waybillNo)
    await sleep(TICKET_QUERY_DELAY_MS)
    if (!res.ok) {
      console.warn(`${label} 工单关联查询失败 waybillNo=${waybillNo}: ${res.message}`)
      return
    }
    if (res.hasTicket) ticketed.add(waybillNo)
  })

  return ticketed
}
