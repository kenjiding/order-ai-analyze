/**
 * iMile 到件扫描查询（ds.imile.com/lm/express/report/v1/biz/inbound/query）。
 * 请求头与控制台「扫描查询 / ScanQuery」对齐，见 portal.IMILE_DC_SCAN_QUERY_PORTAL。
 */

import { requestImileApi } from './client'
import {
  checkImileExportJobStatus,
  createImileExportJob,
  downloadImileExportRows,
  fetchImileExportFileUrl,
  fetchImileExportRows,
  type ImileExportJobStatus,
} from './ipepExportJob'
import { fetchPaginatedResultRows } from './paginatedQuery'
import { buildImilePortalHeaders, IMILE_DC_SCAN_QUERY_PORTAL } from './portal'
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

/** 异步导出任务参数（抓包自 ScanQuery 页「到件扫描」导出按钮）：bizType/moduleId/jobName 固定 */
const INBOUND_EXPORT_BIZ_TYPE = 12024
const INBOUND_EXPORT_MODULE_ID = 10002
const INBOUND_EXPORT_JOB_NAME = '到件扫描'
const INBOUND_EXPORT_PAGE = { envPrefix: 'IMILE_INBOUND_EXPORT', defaults: IMILE_DC_SCAN_QUERY_PORTAL }
// 导出 xlsx 的中文表头 → 字段名，取自真实导出文件核实；字段名同时兼容 parseInboundScanRecord
// （供应商推送用）和 normalizeInboundApiRecord（物流运营工作台分拣效率用）各自读取的 key
const INBOUND_EXPORT_COLUMN_MAP: Record<string, string> = {
  运单号: 'waybillNo',
  路由编码: 'routeCode',
  收件人邮编: 'consigneeZipCode',
  收件人城市: 'city',
  商家编码: 'clientCode',
  扫描时间: 'scanDate',
  扫描员: 'operator',
  扫描类型: 'scanType',
  派件网点: 'deliveryStation',
  扫描网点: 'scanStation',
  商家名称: 'clientName',
}

function buildInboundExportQueryContent(input: { startTime: string; endTime: string }): string {
  return JSON.stringify({
    startTime: input.startTime,
    endTime: input.endTime,
    isLatest: 1,
    scanTypeList: INBOUND_QUERY_DEFAULTS.scanTypeList,
    searchNoList: [],
  })
}

/**
 * 到件扫描改走 ipep 异步导出任务（建任务 → 轮询 → 换链接下载 xlsx），绕开直连 inbound/query 的风控限流。
 * 门户头复用 IMILE_DC_SCAN_QUERY_PORTAL（与直连查询同一个 ScanQuery 页面的导出按钮，resourceCode/path
 * 未单独抓包确认，如鉴权失败用 IMILE_INBOUND_EXPORT_RESOURCE_CODE / IMILE_INBOUND_EXPORT_PATH 勘误）。
 * 返回字段名与 queryImileInboundScans 的 records 对齐，调用方 parseInboundScanRecord 无需改动。
 */
export async function queryImileInboundScansExport(input: {
  imileToken: string
  startTime: string
  endTime: string
}): Promise<{ ok: true; records: Record<string, string>[] } | InboundQueryError> {
  const token = normalizeImileToken(input.imileToken)
  const result = await fetchImileExportRows(
    token,
    INBOUND_EXPORT_PAGE,
    {
      jobType: 1,
      bizType: INBOUND_EXPORT_BIZ_TYPE,
      jobName: INBOUND_EXPORT_JOB_NAME,
      queryContent: buildInboundExportQueryContent(input),
      moduleId: INBOUND_EXPORT_MODULE_ID,
    },
    INBOUND_EXPORT_COLUMN_MAP,
  )
  if (!result.ok) {
    return { ok: false, status: result.status, message: `到件扫描导出${result.message}`, rawText: result.rawText }
  }
  return { ok: true, records: result.rows }
}

/**
 * 物流运营工作台「载入扫描记录」专用：建任务 / 查进度 / 换链接下载三步拆开给调用方（路由）分别暴露，
 * 这样前端才能按 outCount/totalCount 自己驱动轮询、实时展示进度，而不是像 queryImileInboundScansExport
 * 那样一次性等到全部完成。与它共用同一套 bizType/moduleId/查询参数/列映射，仅是编排方式不同。
 */
export async function createInboundScanExportJob(input: {
  imileToken: string
  startTime: string
  endTime: string
}): Promise<{ ok: true; jobId: string; userCode: string } | InboundQueryError> {
  const token = normalizeImileToken(input.imileToken)
  const created = await createImileExportJob(token, INBOUND_EXPORT_PAGE, {
    jobType: 1,
    bizType: INBOUND_EXPORT_BIZ_TYPE,
    jobName: INBOUND_EXPORT_JOB_NAME,
    queryContent: buildInboundExportQueryContent(input),
  })
  if (!created.ok) {
    return { ok: false, status: created.status, message: `到件扫描导出${created.message}`, rawText: created.rawText }
  }
  return created
}

export async function checkInboundScanExportJobStatus(input: {
  imileToken: string
  userCode: string
  jobId: string
}): Promise<ImileExportJobStatus> {
  const token = normalizeImileToken(input.imileToken)
  const status = await checkImileExportJobStatus(token, INBOUND_EXPORT_PAGE, {
    moduleId: INBOUND_EXPORT_MODULE_ID,
    userCode: input.userCode,
    jobType: 1,
    bizType: INBOUND_EXPORT_BIZ_TYPE,
    jobId: input.jobId,
  })
  if (!status.ok) {
    return { ok: false, status: status.status, message: `到件扫描导出${status.message}`, rawText: status.rawText }
  }
  return status
}

export async function finishInboundScanExportJob(input: {
  imileToken: string
  outFilePath: string
}): Promise<{ ok: true; records: Record<string, string>[] } | InboundQueryError> {
  const token = normalizeImileToken(input.imileToken)
  const fileUrl = await fetchImileExportFileUrl(token, INBOUND_EXPORT_PAGE, input.outFilePath)
  if (!fileUrl.ok) {
    return { ok: false, status: fileUrl.status, message: `到件扫描导出${fileUrl.message}`, rawText: fileUrl.rawText }
  }
  try {
    const records = await downloadImileExportRows(fileUrl.url, INBOUND_EXPORT_COLUMN_MAP)
    return { ok: true, records }
  } catch (e) {
    return { ok: false, status: 502, message: (e as Error).message || '导出文件解析失败' }
  }
}

