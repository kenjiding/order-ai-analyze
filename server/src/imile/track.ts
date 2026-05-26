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
  imileRequestJson,
  isRetryableBusyFailure,
  isRetryableUnauthorizedFailure,
  mergeBatchRaw,
  normalizeImileToken,
  readImileBusinessFailure,
  sleep,
  truncateRawText,
  type ImileBusinessFailure,
  type ImileRequestJsonResult,
} from './shared'

const DEFAULT_TRACK_URL = 'https://dc.imile.com/saastms/v1/biz/track/query'

export type TrackEvent = {
  content: string
  time: string
  trackStageTx?: string
  trackType?: string
}

export type TrackQuerySuccess = {
  ok: true
  trackInfo: Record<string, TrackEvent[]>
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

async function postTrack(url: string, imileToken: string, body: Record<string, unknown>): Promise<ImileRequestJsonResult> {
  const normalizedToken = normalizeImileToken(imileToken)
  const headers = buildForwardHeaders(normalizedToken, body)
  return imileRequestJson({
    url,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
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
    const res = await postTrack(url, token, body)
    if (!res.readOk) {
      return {
        ok: false,
        status: res.status,
        message: '轨迹接口返回非 JSON',
        rawText: truncateRawText(res.text),
      }
    }
    if (!res.httpOk) {
      return {
        ok: false,
        status: res.status,
        message: '轨迹接口 HTTP 错误',
        rawText: truncateRawText(res.text),
      }
    }
    const failure = readImileBusinessFailure(res.json)
    if (failure) {
      return {
        ok: false,
        status: res.status,
        message: `轨迹接口业务失败：${failure.message}`,
        rawText: truncateRawText(res.text),
      }
    }
    const trackInfo = extractTrackInfo(res.json)
    return { ok: true, trackInfo, raw: res.json }
  }

  const merged: Record<string, TrackEvent[]> = {}
  const raws: unknown[] = []

  for (const searchValue of orderNos) {
    let resolved = false
    let lastBusinessFailure: { message: string; rawText: string; status: number } | null = null
    const candidates = buildSearchCandidates(searchValue)
    for (const candidate of candidates) {
      const maxAttempts = 3
      let res: ImileRequestJsonResult | null = null
      let failure: ImileBusinessFailure | null = null
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        res = await postTrack(url, token, candidate.body)
        if (!res.readOk || !res.httpOk) break
        failure = readImileBusinessFailure(res.json)
        if (!failure) break
        if (!isRetryableBusyFailure(failure) || attempt >= maxAttempts - 1) break
        await sleep(180 * (attempt + 1))
      }
      if (!res) {
        return {
          ok: false,
          status: 502,
          message: `轨迹查询失败（运单 ${searchValue}）`,
        }
      }

      if (!res.readOk) {
        return {
          ok: false,
          status: res.status,
          message: '轨迹接口返回非 JSON',
          rawText: truncateRawText(res.text),
        }
      }

      if (!res.httpOk) {
        return {
          ok: false,
          status: res.status,
          message: `轨迹接口 HTTP 错误（运单 ${searchValue}）`,
          rawText: truncateRawText(res.text),
        }
      }

      if (failure) {
        lastBusinessFailure = {
          status: res.status,
          message: `轨迹接口业务失败（运单 ${searchValue}，${candidate.label}）：${failure.message}`,
          rawText: truncateRawText(res.text),
        }
        if (isRetryableUnauthorizedFailure(failure)) {
          continue
        }
        return {
          ok: false,
          status: res.status,
          message: lastBusinessFailure.message,
          rawText: lastBusinessFailure.rawText,
        }
      }

      const trackInfo = extractTrackInfo(res.json)
      Object.assign(merged, trackInfo)
      raws.push({ candidate: candidate.label, body: candidate.body, response: res.json })
      resolved = true
      break
    }

    if (!resolved) {
      if (lastBusinessFailure) {
        return {
          ok: false,
          status: lastBusinessFailure.status,
          message: lastBusinessFailure.message,
          rawText: lastBusinessFailure.rawText,
        }
      }
      return {
        ok: false,
        status: 502,
        message: `轨迹查询失败（运单 ${searchValue}）`,
      }
    }
  }

  return {
    ok: true,
    trackInfo: merged,
    raw: mergeBatchRaw(raws),
  }
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

/** 与 src/utils/stripHtmlToPlainText.ts maskPhoneNumbersInText 保持同步 */
function maskPhoneNumbersInText(text: string): string {
  if (!text) return text
  let s = text

  const cnMobile =
    /(?<![0-9])(?:\+?86(?:[-\s]|\u00b7|\u2022)*|0086(?:[-\s]|\u00b7|\u2022)*)?1[3-9](?:[-\s·•]?\d){9}(?![0-9])/g
  s = s.replace(cnMobile, '***')

  const auIntlMobile =
    /(?<![0-9])\+?61(?:[-\s·•]*)4(?:[-\s·•]*\d){8}(?![0-9])/g
  s = s.replace(auIntlMobile, '***')

  const auIDD61Mobile = /(?<![0-9])0061(?:[-\s·•]*)4(?:[-\s·•]*\d){8}(?![0-9])/g
  s = s.replace(auIDD61Mobile, '***')

  const auDomesticMobile = /(?<![0-9])04(?:[-\s·•]*\d){8}(?![0-9])/g
  s = s.replace(auDomesticMobile, '***')

  const auIntlLandline =
    /(?<![0-9])\+?61(?:[-\s·•]*)(?:2|3|7|8)(?:[-\s·•]*\d){8}(?![0-9])/g
  s = s.replace(auIntlLandline, '***')

  const auNatLandline =
    /(?<![0-9])0(?:[-\s·•]*)(?:2|3|7|8)(?:[-\s·•]*\d){8}(?![0-9])/g
  s = s.replace(auNatLandline, '***')

  const cnLandline = /(?<![0-9])0\d{2,3}[-\s·•]?\d{7,8}(?![0-9])/g
  s = s.replace(cnLandline, '***')

  const cnToll400800 = /(?<![0-9])[48]00[-\s·•]?\d{3}[-\s·•]?\d{4}(?![0-9])/g
  s = s.replace(cnToll400800, '***')

  return s
}

/** 与 src/utils/stripHtmlToPlainText.ts stripIdColonLabels 保持同步 */
function stripIdColonLabels(text: string): string {
  if (!text) return text
  const re = /\b[Ii][Dd]\s*[:：]\s*[^\s，。；、）)\]\n\r]+/g
  return text.replace(re, '').replace(/\s{2,}/g, ' ').trim()
}

function sanitizeTrackPlainText(html: string): string {
  const plain = stripHtmlToPlainText(html)
  const masked = maskPhoneNumbersInText(plain)
  return stripIdColonLabels(masked)
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

/** 与路由层、入参归一化共用：除 `<important>` 外无 HTML 标签，号码脱敏。 */
export function normalizeTrackEvent(raw: unknown): TrackEvent {
  const row = raw as { content?: string; time?: string; trackStageTx?: string; trackType?: string }
  const txRaw = row?.trackStageTx != null ? String(row.trackStageTx) : ''
  const tx = txRaw ? sanitizeTrackPlainText(txRaw) : ''
  const typeRaw = row?.trackType != null ? String(row.trackType) : ''
  const type = typeRaw ? sanitizeTrackPlainText(typeRaw) : ''
  return {
    content: sanitizeTrackPlainText(String(row?.content ?? '')),
    time: normalizeTrackTime(String(row?.time ?? '')),
    trackStageTx: tx || undefined,
    trackType: type || undefined,
  }
}
