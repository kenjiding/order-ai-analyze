/**
 * iMile ipep 异步导出任务通用流程：add_export（建任务）→ get_list（轮询直到 outFilePath 出现）→
 * get_url_by_file_key（换真实下载链接）→ 下载 xlsx 取列。用于替代直接查询类接口被限流/风控的场景。
 * 三步都要求 application/x-www-form-urlencoded + front-sec 带非空 userCode（见 portal.ts 顶注释）。
 */
import ExcelJS from 'exceljs'
import { requestImileApi } from './client'
import { buildImilePortalHeaders, type ImilePortalDefaults } from './portal'
import { envFirstOr, isRecord, normalizeImileToken, sleep } from './shared'

const ADD_EXPORT_URL = envFirstOr(['IMILE_IPEP_ADD_EXPORT_URL'], 'https://ds.imile.com/ipep/job/add_export')
const GET_LIST_URL = envFirstOr(['IMILE_IPEP_GET_LIST_URL'], 'https://ds.imile.com/ipep/job/get_list')
const GET_URL_BY_FILE_KEY_URL = envFirstOr(
  ['IMILE_IPEP_GET_URL_BY_FILE_KEY_URL'],
  'https://ds.imile.com/ipep/oss/get_url_by_file_key',
)

export type ImileExportJobError = { ok: false; status: number; message: string; rawText?: string }

export type ImileExportJobPage = {
  /** 环境变量前缀，如 IMILE_CLOSURE_EXPORT */
  envPrefix: string
  defaults: ImilePortalDefaults
}

function makeHeaders(token: string, page: ImileExportJobPage): Record<string, string> {
  const pagePath = page.defaults.path ?? ''
  return buildImilePortalHeaders({
    token,
    envPrefix: page.envPrefix,
    defaults: page.defaults,
    sharedEnvPrefixes: ['IMILE_TRACK'],
    // front-sec 只要求 userCode 非空，不校验真实账号，占位值即可（见 portal.ts 顶注释）
    injectUserCode: true,
    overrides: { userCode: envFirstOr([`${page.envPrefix}_USER_CODE`], '1') },
    extra: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(pagePath ? { 'x-page-path': `https://ds.imile.com/#${pagePath}` } : {}),
    },
  })
}

function readResultObject(json: unknown): unknown {
  return isRecord(json) ? json.resultObject : undefined
}

/** 步骤1：创建异步导出任务，返回 jobId 与（回填自 front-sec 的）userCode，供步骤2轮询用。 */
export async function createImileExportJob(
  token: string,
  page: ImileExportJobPage,
  params: { jobType: number; bizType: number; jobName: string; queryContent: string },
): Promise<{ ok: true; jobId: string; userCode: string } | ImileExportJobError> {
  const headers = makeHeaders(token, page)
  const result = await requestImileApi({
    url: ADD_EXPORT_URL,
    method: 'POST',
    headers,
    bodyEncoding: 'form',
    body: {
      jobType: String(params.jobType),
      bizType: String(params.bizType),
      jobName: params.jobName,
      totalCount: '0',
      queryContent: params.queryContent,
    },
    label: '异步导出任务创建',
    retryBusy: false,
  })
  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message, rawText: result.rawText }
  }
  const ro = readResultObject(result.json)
  const jobId = isRecord(ro) ? String(ro.jobId ?? '').trim() : ''
  const userCode = isRecord(ro) ? String(ro.userId ?? '').trim() : ''
  if (!jobId || !userCode) {
    return { ok: false, status: 502, message: '异步导出任务创建返回缺少 jobId/userId' }
  }
  return { ok: true, jobId, userCode }
}

/** 步骤2：轮询任务列表，直到匹配 jobId 的任务行出现 outFilePath（完成）或 errorMsg（失败）。 */
export async function pollImileExportJob(
  token: string,
  page: ImileExportJobPage,
  params: { moduleId: number; userCode: string; jobType: number; bizType: number; jobId: string },
  options?: { intervalMs?: number; maxAttempts?: number },
): Promise<{ ok: true; outFilePath: string } | ImileExportJobError> {
  const intervalMs = options?.intervalMs ?? 2000
  const maxAttempts = options?.maxAttempts ?? 40 // 封顶约 80s，避免无限轮询
  const headers = makeHeaders(token, page)

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await requestImileApi({
      url: GET_LIST_URL,
      method: 'POST',
      headers,
      bodyEncoding: 'form',
      body: {
        moduleId: String(params.moduleId),
        userCode: params.userCode,
        jobType: String(params.jobType),
        bizType: String(params.bizType),
      },
      label: '导出任务列表查询',
      retryBusy: false,
    })
    if (!result.ok) {
      return { ok: false, status: result.status, message: result.message, rawText: result.rawText }
    }
    const ro = readResultObject(result.json)
    const rows = Array.isArray(ro) ? ro : []
    const match = rows.find((row) => isRecord(row) && String(row.jobId ?? '') === params.jobId)
    if (isRecord(match)) {
      const outFilePath = String(match.outFilePath ?? '').trim()
      if (outFilePath) return { ok: true, outFilePath }
      const errorMsg = String(match.errorMsg ?? '').trim()
      if (errorMsg) return { ok: false, status: 502, message: `导出任务失败：${errorMsg}` }
    }
    if (attempt < maxAttempts - 1) await sleep(intervalMs)
  }
  return { ok: false, status: 504, message: '导出任务轮询超时，任务可能仍在处理中' }
}

/** 步骤3：用 outFilePath 当 fileKey 换真实下载地址（OSS 签名 URL，不需要再带 iMile 鉴权头）。 */
export async function fetchImileExportFileUrl(
  token: string,
  page: ImileExportJobPage,
  fileKey: string,
): Promise<{ ok: true; url: string } | ImileExportJobError> {
  const headers = makeHeaders(token, page)
  const url = `${GET_URL_BY_FILE_KEY_URL}?fileKey=${encodeURIComponent(fileKey)}&bucketType=1`
  const result = await requestImileApi({ url, method: 'GET', headers, label: '导出文件下载地址', retryBusy: false })
  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message, rawText: result.rawText }
  }
  const downloadUrl = String(readResultObject(result.json) ?? '').trim()
  if (!downloadUrl) return { ok: false, status: 502, message: '导出文件下载地址为空' }
  return { ok: true, url: downloadUrl }
}

/** 下载导出的 xlsx 并按表头文本取某一列的值（如「运单号」）。 */
export async function downloadImileExportColumn(downloadUrl: string, columnHeader: string): Promise<string[]> {
  const res = await fetch(downloadUrl)
  if (!res.ok) throw new Error(`导出文件下载失败：HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())

  const workbook = new ExcelJS.Workbook()
  // exceljs 的类型定义比 @types/node 的 Buffer<ArrayBufferLike> 泛型旧，运行时是同一个 Buffer 实例
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const sheet = workbook.worksheets[0]
  if (!sheet) return []

  let columnIndex = -1
  sheet.getRow(1).eachCell((cell, colNumber) => {
    if (String(cell.value ?? '').trim() === columnHeader) columnIndex = colNumber
  })
  if (columnIndex === -1) return []

  const values: string[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const raw = row.getCell(columnIndex).value
    const value = raw == null ? '' : String(raw).trim()
    if (value) values.push(value)
  })
  return values
}

/** 整体编排：建任务 → 轮询 → 换链接 → 下载解析，返回指定列的值。 */
export async function fetchImileExportColumnValues(
  token: string,
  page: ImileExportJobPage,
  job: { jobType: number; bizType: number; jobName: string; queryContent: string; moduleId: number },
  columnHeader: string,
  pollOptions?: { intervalMs?: number; maxAttempts?: number },
): Promise<{ ok: true; values: string[] } | ImileExportJobError> {
  const token2 = normalizeImileToken(token)
  const created = await createImileExportJob(token2, page, job)
  if (!created.ok) return created

  const polled = await pollImileExportJob(
    token2,
    page,
    { moduleId: job.moduleId, userCode: created.userCode, jobType: job.jobType, bizType: job.bizType, jobId: created.jobId },
    pollOptions,
  )
  if (!polled.ok) return polled

  const fileUrl = await fetchImileExportFileUrl(token2, page, polled.outFilePath)
  if (!fileUrl.ok) return fileUrl

  try {
    const values = await downloadImileExportColumn(fileUrl.url, columnHeader)
    return { ok: true, values }
  } catch (e) {
    return { ok: false, status: 502, message: (e as Error).message || '导出文件解析失败' }
  }
}
