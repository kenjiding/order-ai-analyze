/**
 * iMile 轨迹查询。默认请求体（与控制台一致）：
 * { isCenter: 1, searchType: "waybillNo", searchValue: "<单个订单号>" }
 * 多订单时在服务端循环请求并合并 resultObject.trackInfo。
 *
 * 可选环境变量：IMILE_TRACK_URL、IMILE_TRACK_IS_CENTER、IMILE_TRACK_SEARCH_TYPE、
 * IMILE_TRACK_HUBCODE、IMILE_TRACK_LANG、IMILE_TRACK_TIMEZONE、IMILE_TRACK_FRONT_SEC、
 * IMILE_TRACK_RESOURCE_CODE、IMILE_TRACK_PATH_TEMPLATE、IMILE_TRACK_PAGE_PATH_TEMPLATE、
 * IMILE_TRACK_ORIGIN、IMILE_TRACK_REFERER、IMILE_TRACK_SYS_NAME、IMILE_TRACK_SYS_PORTAL、
 * IMILE_TRACK_COOKIE、IMILE_TRACK_BODY_MODE=legacy_orderNoList。
 */

import {
  buildImileAuthHeaders,
  envFirstOr,
  isRetryableBusyFailure,
  isRetryableUnauthorizedFailure,
  mergeBatchRaw,
  normalizeImileToken,
  sleep,
} from './shared'
import { requestImileApi } from './client'
import { mapWithConcurrency } from '../orderAnalyze/runtime'

function readTrackConcurrency(): number {
  const raw = Number.parseInt(String(process.env.IMILE_TRACK_CONCURRENCY ?? ''), 10)
  if (!Number.isFinite(raw)) return 10
  if (raw < 1) return 1
  if (raw > 20) return 20
  return raw
}

/** 包装单订单轨迹查询失败，用于在并发中传递错误而不中断其他任务收集。 */
class SingleTrackError extends Error {
  constructor(public readonly detail: TrackQueryError) {
    super(detail.message)
    this.name = 'SingleTrackError'
  }
}

const DEFAULT_TRACK_URL = 'https://ds.imile.com/saastms/v1/biz/track/query'

export type TrackEvent = {
  content: string
  time: string
  trackStageTx?: string
  trackType?: string
  /** 问题件轨迹文案里 viewPic 的 data-pic 文件 key 列表，用于前端点击查看证明图片 */
  proofFileKeys?: string[]
}

/** 与 iMile track/query 的 resultObject.baseInfo、skuInfo、consigneeInfo 对齐，供异常订单 Drawer 展示。 */
export type OrderQueryInfo = {
  merchantName: string
  merchantCode: string
  totalWeight: string
  customerDeclaredValueAud: string
  declaredValueUsd: string
  /** resultObject.consigneeInfo.consigneeRouteCode，供「路由码」列展示 */
  consigneeRouteCode: string
  /** resultObject.baseInfo.amName */
  amName: string
  /** resultObject.consigneeInfo.consigneeProvince */
  consigneeProvince: string
  /** resultObject.consigneeInfo.consigneeCity */
  consigneeCity: string
  /** resultObject.consigneeInfo.consigneeAddress */
  consigneeAddress: string
  /** resultObject.consigneeInfo.consigneeZipCode */
  consigneeZipCode: string
}

export type TrackQuerySuccess = {
  ok: true
  trackInfo: Record<string, TrackEvent[]>
  orderInfo: Record<string, OrderQueryInfo | null>
  raw: unknown
}

export type TrackQueryError = {
  ok: false
  status: number
  message: string
  rawText?: string
}

function buildLegacyBatchBody(orderNos: string[]): Record<string, unknown> {
  const mode = process.env.IMILE_TRACK_LEGACY_LIST_FIELD ?? 'orderNoList'
  switch (mode) {
    case 'waybillNoList':
      return { waybillNoList: orderNos }
    case 'orderNos':
      return { orderNos }
    case 'orderNoList':
    default:
      return { orderNoList: orderNos }
  }
}

type TrackSearchCandidate = {
  label: string
  body: Record<string, unknown>
}

function readBodySearchValue(body: Record<string, unknown>): string {
  return String(body.searchValue ?? body.waybillNo ?? '').trim()
}

function fillTemplate(template: string, waybillNo: string): string {
  return template.replaceAll('{waybillNo}', encodeURIComponent(waybillNo))
}

function buildForwardHeaders(imileToken: string, body: Record<string, unknown>): Record<string, string> {
  const searchValue = readBodySearchValue(body)
  const pathTemplate =
    process.env.IMILE_TRACK_PATH_TEMPLATE ??
    '/DSOperation/WaybillManagement/dsTrackQuery?waybillNo={waybillNo}'
  const pagePathTemplate =
    process.env.IMILE_TRACK_PAGE_PATH_TEMPLATE ??
    'https://ds.imile.com/#/DSOperation/WaybillManagement/dsTrackQuery?waybillNo={waybillNo}'

  return buildImileAuthHeaders({
    token: imileToken,
    resourceCode: envFirstOr(['IMILE_TRACK_RESOURCE_CODE'], 'dsTrackQuery'),
    sysName: envFirstOr(['IMILE_TRACK_SYS_NAME'], 'DS'),
    sysPortal: envFirstOr(['IMILE_TRACK_SYS_PORTAL'], 'DS'),
    origin: envFirstOr(['IMILE_TRACK_ORIGIN'], 'https://ds.imile.com'),
    referer: envFirstOr(['IMILE_TRACK_REFERER'], 'https://ds.imile.com/'),
    frontSecEnvKeys: ['IMILE_TRACK_FRONT_SEC'],
    hubcodeEnvKeys: ['IMILE_TRACK_HUBCODE'],
    langEnvKeys: ['IMILE_TRACK_LANG'],
    timezoneEnvKeys: ['IMILE_TRACK_TIMEZONE'],
    cookieEnvKeys: ['IMILE_TRACK_COOKIE'],
    extra: {
      'Content-Type': 'application/json',
      path: fillTemplate(pathTemplate, searchValue),
      'x-page-path': fillTemplate(pagePathTemplate, searchValue),
    },
  })
}

function buildSearchCandidates(searchValue: string): TrackSearchCandidate[] {
  const envSearchType = String(process.env.IMILE_TRACK_SEARCH_TYPE ?? '').trim()
  const envIsCenterRaw = process.env.IMILE_TRACK_IS_CENTER
  const envIsCenter =
    typeof envIsCenterRaw === 'string' && envIsCenterRaw.trim() !== ''
      ? Number(envIsCenterRaw)
      : undefined

  const candidates: TrackSearchCandidate[] = []
  const push = (label: string, isCenter: number, searchType: string) => {
    candidates.push({
      label,
      body: {
        isCenter,
        searchType,
        searchValue,
      },
    })
  }

  if (envSearchType) {
    const center = Number.isFinite(envIsCenter) ? Number(envIsCenter) : 1
    push(`env(${searchTypeKey(envSearchType)},${center})`, center, envSearchType)
  }

  push('default(waybillNo,1)', 1, 'waybillNo')
  push('fallback(waybillNo,0)', 0, 'waybillNo')

  const deduped = new Map<string, TrackSearchCandidate>()
  for (const item of candidates) {
    const key = JSON.stringify(item.body)
    if (!deduped.has(key)) deduped.set(key, item)
  }
  return Array.from(deduped.values())
}

function searchTypeKey(searchType: string): string {
  return searchType.replace(/\s+/g, '')
}

async function postTrack(
  url: string,
  imileToken: string,
  body: Record<string, unknown>,
  label: string,
) {
  const headers = buildForwardHeaders(normalizeImileToken(imileToken), body)
  return requestImileApi({
    url,
    method: 'POST',
    headers,
    body,
    label,
  })
}

export async function queryImileTracks(
  imileToken: string,
  orderNos: string[],
): Promise<TrackQuerySuccess | TrackQueryError> {
  const url = process.env.IMILE_TRACK_URL ?? DEFAULT_TRACK_URL
  const token = normalizeImileToken(imileToken)
  const legacyMode = process.env.IMILE_TRACK_BODY_MODE === 'legacy_orderNoList'

  if (legacyMode) {
    const body = buildLegacyBatchBody(orderNos)
    const res = await postTrack(url, token, body, '轨迹查询')
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: res.message,
        rawText: res.rawText,
      }
    }
    const trackInfo = extractTrackInfo(res.json)
    const orderInfo = mapOrderInfoForTrackKeys(trackInfo, extractOrderInfo(res.json))
    return { ok: true, trackInfo, orderInfo, raw: res.json }
  }

  const concurrency = readTrackConcurrency()

  /**
   * 查询单个运单轨迹；失败抛 SingleTrackError 供并发层收集。
   * "系统繁忙"最多重试 2 次（间隔 1.5 s / 3 s），其余错误立即抛出。
   */
  async function fetchOneOrderTrack(
    searchValue: string
  ): Promise<{ trackInfo: Record<string, TrackEvent[]>; orderInfo: Record<string, OrderQueryInfo | null>; raw: unknown }> {
    const candidates = buildSearchCandidates(searchValue)
    const MAX_BUSY_RETRIES = 2
    let lastFailure: { message: string; rawText?: string; status: number } | null = null

    for (let attempt = 0; attempt <= MAX_BUSY_RETRIES; attempt++) {
      if (attempt > 0) await sleep(1500 * attempt) // 1.5 s → 3 s

      let hitBusy = false

      for (const candidate of candidates) {
        const res = await postTrack(
          url,
          token,
          candidate.body,
          `轨迹查询（运单 ${searchValue}，${candidate.label}）`,
        )
        if (res.ok) {
          const trackInfo = extractTrackInfo(res.json)
          const orderInfo = mapOrderInfoForTrackKeys(trackInfo, extractOrderInfo(res.json), searchValue)
          return { trackInfo, orderInfo, raw: { candidate: candidate.label, body: candidate.body, response: res.json } }
        }

        if (res.businessFailure && isRetryableUnauthorizedFailure(res.businessFailure)) {
          lastFailure = { status: res.status, message: res.message, rawText: res.rawText }
          continue // 尝试下一个候选参数
        }

        if (res.businessFailure && isRetryableBusyFailure(res.businessFailure)) {
          hitBusy = true
          lastFailure = { status: res.status, message: res.message, rawText: res.rawText }
          break // 跳出候选循环，等待后重试本次 attempt
        }

        throw new SingleTrackError({ ok: false, status: res.status, message: res.message, rawText: res.rawText })
      }

      if (!hitBusy) break // 非 busy（auth 失败耗尽候选），不做 busy 重试
    }

    throw new SingleTrackError(
      lastFailure
        ? { ok: false, status: lastFailure.status, message: lastFailure.message, rawText: lastFailure.rawText }
        : { ok: false, status: 502, message: `轨迹查询失败（运单 ${searchValue}）` }
    )
  }

  try {
    const perOrderResults = await mapWithConcurrency(orderNos, concurrency, (searchValue) =>
      fetchOneOrderTrack(searchValue)
    )
    const merged: Record<string, TrackEvent[]> = {}
    const mergedOrderInfo: Record<string, OrderQueryInfo | null> = {}
    const raws: unknown[] = []
    for (const { trackInfo, orderInfo, raw } of perOrderResults) {
      Object.assign(merged, trackInfo)
      Object.assign(mergedOrderInfo, orderInfo)
      raws.push(raw)
    }
    return { ok: true, trackInfo: merged, orderInfo: mergedOrderInfo, raw: mergeBatchRaw(raws) }
  } catch (e) {
    if (e instanceof SingleTrackError) return e.detail
    throw e
  }
}

function readPlainField(raw: unknown): string {
  if (raw == null) return ''
  const s = String(raw).trim()
  return s
}

export function extractOrderInfo(payload: unknown): OrderQueryInfo | null {
  const root = payload as {
    resultObject?: {
      baseInfo?: Record<string, unknown>
      skuInfo?: Record<string, unknown>
      consigneeInfo?: Record<string, unknown>
    }
    baseInfo?: Record<string, unknown>
    skuInfo?: Record<string, unknown>
    consigneeInfo?: Record<string, unknown>
  }
  const bag = root?.resultObject ?? root
  const base = bag?.baseInfo
  const sku = bag?.skuInfo
  const consignee = bag?.consigneeInfo
  if (!base && !sku && !consignee) return null

  const clientName = readPlainField(base?.clientName)
  const createUserName = readPlainField(base?.createUserName)
  const merchantName = clientName || createUserName

  return {
    merchantName,
    merchantCode: readPlainField(base?.clientCode),
    totalWeight: readPlainField(sku?.totalWeight),
    customerDeclaredValueAud: readPlainField(sku?.customerDeclaredValue),
    declaredValueUsd: readPlainField(sku?.declaredValue),
    consigneeRouteCode: readPlainField(consignee?.consigneeRouteCode),
    amName: readPlainField(base?.amName),
    consigneeProvince: readPlainField(consignee?.consigneeProvince),
    consigneeCity: readPlainField(consignee?.consigneeCity),
    consigneeAddress: readPlainField(consignee?.consigneeAddress),
    consigneeZipCode: readPlainField(consignee?.consigneeZipCode),
  }
}

function mapOrderInfoForTrackKeys(
  trackInfo: Record<string, TrackEvent[]>,
  info: OrderQueryInfo | null,
  ...extraKeys: string[]
): Record<string, OrderQueryInfo | null> {
  const out: Record<string, OrderQueryInfo | null> = {}
  const keys = new Set([...Object.keys(trackInfo), ...extraKeys.filter(Boolean)])
  if (!keys.size) {
    for (const key of extraKeys) {
      if (key) out[key] = info
    }
    return out
  }
  for (const key of keys) out[key] = info
  return out
}

function extractTrackInfo(payload: unknown): Record<string, TrackEvent[]> {
  const root = payload as {
    resultObject?: { trackInfo?: Record<string, unknown> }
    trackInfo?: Record<string, unknown>
  }
  const bag = root?.resultObject?.trackInfo ?? root?.trackInfo
  if (!bag || typeof bag !== 'object') return {}

  const out: Record<string, TrackEvent[]> = {}
  for (const [orderNo, events] of Object.entries(bag)) {
    if (!Array.isArray(events)) continue
    out[orderNo] = events.map(normalizeTrackEvent).filter((e) => e.content || e.time)
  }
  return out
}

const PROOF_DATA_PIC_RE = /data-pic=(['"])([\s\S]*?)\1/i

/** 从原始轨迹文案里取出 viewPic 的 data-pic（逗号分隔的文件 key），标签本身仍会被 stripHtmlToPlainText 砍掉。 */
function extractProofFileKeys(rawContent: string): string[] {
  const match = PROOF_DATA_PIC_RE.exec(rawContent)
  if (!match) return []
  return match[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 去掉轨迹文案里的 HTML 标签；保留 `<important>...</important>`，其余标签删除（与前端 stripHtmlToPlainText 一致）。 */
function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(?!\/?important\b)[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 异常订单分析链路保留完整轨迹文本，仅去除 HTML 噪音。 */
function sanitizeTrackPlainText(html: string): string {
  return stripHtmlToPlainText(html)
}

function normalizeTrackTime(raw: string): string {
  const s = raw.trim()
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(s)
  if (!m) return s

  const pad = (value: string): string => value.padStart(2, '0')
  const date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  if (!m[4] || !m[5]) return date
  return `${date} ${pad(m[4])}:${pad(m[5])}:${pad(m[6] ?? '0')}`
}

/** 与路由层、入参归一化共用：保留完整业务文本，仅去除 HTML 标签。 */
export function normalizeTrackEvent(raw: unknown): TrackEvent {
  const row = raw as { content?: string; time?: string; trackStageTx?: string; trackType?: string }
  const rawContent = String(row?.content ?? '')
  const txRaw = row?.trackStageTx != null ? String(row.trackStageTx) : ''
  const tx = txRaw ? sanitizeTrackPlainText(txRaw) : ''
  const typeRaw = row?.trackType != null ? String(row.trackType) : ''
  const type = typeRaw ? sanitizeTrackPlainText(typeRaw) : ''
  const proofFileKeys = extractProofFileKeys(rawContent)
  return {
    content: sanitizeTrackPlainText(rawContent),
    time: normalizeTrackTime(String(row?.time ?? '')),
    trackStageTx: tx || undefined,
    trackType: type || undefined,
    proofFileKeys: proofFileKeys.length ? proofFileKeys : undefined,
  }
}

const OSS_GET_URL_BY_FILE_KEY = 'https://ds.imile.com/ipep/oss/get_url_by_file_key'

export type TrackProofImageResult =
  | { ok: true; url: string }
  | { ok: false; status: number; message: string; rawText?: string }

/** 问题件轨迹 viewPic 的 data-pic 文件 key → 真实图片地址（resultObject）。 */
export async function getTrackProofImageUrl(
  imileToken: string,
  fileKey: string,
): Promise<TrackProofImageResult> {
  const token = normalizeImileToken(imileToken)
  const url = `${OSS_GET_URL_BY_FILE_KEY}?fileKey=${encodeURIComponent(fileKey)}&bucketType=1`
  const headers = buildImileAuthHeaders({
    token,
    resourceCode: envFirstOr(['IMILE_TRACK_PROOF_RESOURCE_CODE'], 'ossGetUrlByFileKey'),
    sysName: envFirstOr(['IMILE_TRACK_SYS_NAME'], 'DS'),
    sysPortal: envFirstOr(['IMILE_TRACK_SYS_PORTAL'], 'DS'),
    origin: envFirstOr(['IMILE_TRACK_ORIGIN'], 'https://ds.imile.com'),
    referer: envFirstOr(['IMILE_TRACK_REFERER'], 'https://ds.imile.com/'),
    frontSecEnvKeys: ['IMILE_TRACK_FRONT_SEC'],
    hubcodeEnvKeys: ['IMILE_TRACK_HUBCODE'],
    langEnvKeys: ['IMILE_TRACK_LANG'],
    timezoneEnvKeys: ['IMILE_TRACK_TIMEZONE'],
    cookieEnvKeys: ['IMILE_TRACK_COOKIE'],
  })

  const result = await requestImileApi({
    url,
    method: 'GET',
    headers,
    label: '问题件图片地址查询',
    retryBusy: true,
  })

  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message, rawText: result.rawText }
  }

  const imageUrl = String((result.json as { resultObject?: unknown })?.resultObject ?? '').trim()
  if (!imageUrl) {
    return { ok: false, status: 200, message: '图片地址为空' }
  }
  return { ok: true, url: imageUrl }
}
