/** iMile 开放平台 HTTP 调用公共能力（轨迹、阻断日志等接口共用）。业务模块请通过 client.requestImileApi 发请求，勿直接调用 imileRequestJson。 */

import { AsyncLocalStorage } from 'node:async_hooks'

export const IMILE_DEFAULT_FRONT_SEC = JSON.stringify({
  orgId: 10,
  entId: 10,
  moduleId: 10007,
  client: 'pc',
})

export const IMILE_DEFAULT_HUBCODE = 'S210431701'
/** 系统默认国家：与前端「国家选择器」一致；无请求上下文时兜底 */
export const IMILE_DEFAULT_COUNTRY = 'AUS'
export const IMILE_DEFAULT_LANG = 'zh_CN'
export const IMILE_DEFAULT_TIMEZONE = '+10'

/**
 * 正式 iMile 切国家时同步切换的时区偏移（见浏览器抓包）：
 * AUS → timezone=+10 / TIMEZONE_COUNTRY=AUS
 * NZL → timezone=+12 / TIMEZONE_COUNTRY=NZL
 */
export const IMILE_COUNTRY_TIMEZONE: Record<string, string> = {
  AUS: '+10',
  NZL: '+12',
}

/** 前端国家选择器允许的值 */
const IMILE_COUNTRY_CODES = new Set(['AUS', 'NZL'])

export function isImileCountryCode(value: string): boolean {
  return IMILE_COUNTRY_CODES.has(value)
}

export type ImileBusinessFailure = {
  code: string
  message: string
}

/** 单次 iMile 请求超时（毫秒）：避免上游挂起导致定时任务无限期卡住 */
export const DEFAULT_IMILE_REQUEST_TIMEOUT_MS = 30_000

export type ImileRequestJsonResult =
  | { readOk: true; httpOk: boolean; status: number; json: unknown; text: string }
  | { readOk: false; status: number; text: string; networkError?: boolean }

export type ImileAuthHeaderConfig = {
  token: string
  resourceCode: string
  sysName: string
  sysPortal: string
  origin: string
  referer: string
  frontSecEnvKeys?: string[]
  hubcodeEnvKeys?: string[]
  langEnvKeys?: string[]
  timezoneEnvKeys?: string[]
  cookieEnvKeys?: string[]
  extra?: Record<string, string>
}

export function normalizeImileToken(raw: string): string {
  return raw.replace(/^Bearer\s+/i, '').trim()
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 按顺序读取环境变量，返回第一个非空值。 */
export function envFirst(...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return undefined
}

export function envFirstOr(keys: string[], fallback: string): string {
  return envFirst(...keys) ?? fallback
}

/** 读取系统默认站点编码（stationCode / hubcode）。 */
export function readDefaultImileHubcode(): string {
  return envFirst('IMILE_TRACK_HUBCODE', 'IMILE_INTERCEPT_HUBCODE') ?? IMILE_DEFAULT_HUBCODE
}

/**
 * 请求级 hubcode 上下文：由 imileHubcodeMiddleware 在进入路由前，
 * 以前端「站点选择器」传来的 hubcode 请求头填充，供 buildImileAuthHeaders 统一取用。
 * 定时任务等无 HTTP 请求上下文的调用不受影响，仍走 env/默认值兜底。
 */
const imileHubcodeStorage = new AsyncLocalStorage<string>()

export function runWithImileHubcode<T>(hubcode: string, fn: () => T): T {
  return imileHubcodeStorage.run(hubcode, fn)
}

export function getRequestImileHubcode(): string | undefined {
  return imileHubcodeStorage.getStore()
}

/**
 * 请求级 country 上下文：由 imileHubcodeMiddleware 注入前端「国家选择器」的 country 请求头。
 * 定时任务等无 HTTP 上下文时 resolveImileCountry 回退到常量 AUS。
 */
const imileCountryStorage = new AsyncLocalStorage<string>()

export function runWithImileCountry<T>(country: string, fn: () => T): T {
  return imileCountryStorage.run(country, fn)
}

export function getRequestImileCountry(): string | undefined {
  return imileCountryStorage.getStore()
}

/**
 * 解析本次 iMile 调用应使用的国家码。
 * 优先级：显式 override（如 job payload）→ 请求头上下文（国家选择器）→ 默认 AUS。
 */
export function resolveImileCountry(override?: string): string {
  const fromOverride = String(override ?? '').trim().toUpperCase()
  if (fromOverride && isImileCountryCode(fromOverride)) return fromOverride
  return getRequestImileCountry() || IMILE_DEFAULT_COUNTRY
}

/** 国家选择器对应的 timezone 请求头（与正式站切国家行为一致） */
export function resolveImileTimezone(country?: string): string {
  const code = resolveImileCountry(country)
  return IMILE_COUNTRY_TIMEZONE[code] ?? IMILE_DEFAULT_TIMEZONE
}

/** 写入 / 覆盖 cookie 中的单个键（不影响其它键） */
function setCookiePair(cookie: string, key: string, value: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|;\\s*)${escaped}=[^;]*`, 'i')
  if (re.test(cookie)) return cookie.replace(re, `$1${key}=${value}`)
  const trimmed = cookie.trim()
  return trimmed ? `${trimmed}; ${key}=${value}` : `${key}=${value}`
}

/**
 * 正式站切国家会改 Cookie 的 TIMEZONE / TIMEZONE_COUNTRY；
 * 仅改 countries 而 Cookie 仍是 AUS 时，站点列表不会变。
 */
export function applyImileCountryToCookie(cookie: string | undefined, country?: string): string {
  const code = resolveImileCountry(country)
  const tz = resolveImileTimezone(code)
  let next = cookie?.trim() ?? ''
  next = setCookiePair(next, 'TIMEZONE', tz)
  next = setCookiePair(next, 'TIMEZONE_COUNTRY', code)
  return next
}

export function buildImileAuthHeaders(config: ImileAuthHeaderConfig): Record<string, string> {
  const token = normalizeImileToken(config.token)
  const country = resolveImileCountry()
  const timezone = resolveImileTimezone(country)
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${token}`,
    'front-sec': envFirst(...(config.frontSecEnvKeys ?? [])) ?? IMILE_DEFAULT_FRONT_SEC,
    hubcode:
      getRequestImileHubcode() || envFirst(...(config.hubcodeEnvKeys ?? [])) || IMILE_DEFAULT_HUBCODE,
    lang: envFirst(...(config.langEnvKeys ?? [])) ?? IMILE_DEFAULT_LANG,
    // 国家选择器驱动 timezone，不再用写死的 +10 / env 覆盖正式切国行为
    timezone,
    'resource-code': config.resourceCode,
    'sys-name': config.sysName,
    'sys-portal': config.sysPortal,
    Origin: config.origin,
    Referer: config.referer,
    ...config.extra,
  }

  const cookie = envFirst(...(config.cookieEnvKeys ?? []))
  headers.Cookie = applyImileCountryToCookie(cookie, country)
  return headers
}

export async function imileRequestJson(options: {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  timeoutMs?: number
}): Promise<ImileRequestJsonResult> {
  let response: Response
  try {
    response = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_IMILE_REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return {
      readOk: false,
      status: 502,
      text: timedOut ? '请求超时' : (e as Error).message || '网络异常',
      networkError: true,
    }
  }

  const text = await response.text()
  try {
    const json = text ? JSON.parse(text) : {}
    return { readOk: true, httpOk: response.ok, status: response.status, json, text }
  } catch {
    return { readOk: false, status: response.status, text }
  }
}

export function truncateRawText(text: string, maxLen = 2000): string {
  return text.slice(0, maxLen)
}

/** 多单查询时合并 raw 响应：单笔直接返回，多笔包装为 batch。 */
export function mergeBatchRaw<T>(raws: T[]): T | { batch: true; responses: T[] } {
  return raws.length === 1 ? raws[0] : { batch: true, responses: raws }
}

export function readImileBusinessFailure(payload: unknown): ImileBusinessFailure | null {
  const root = payload as {
    status?: unknown
    resultCode?: unknown
    message?: unknown
  }
  const status = String(root?.status ?? '').toLowerCase()
  if (status !== 'failure') return null
  return {
    code: String(root?.resultCode ?? ''),
    message: String(root?.message ?? 'iMile 接口业务失败'),
  }
}

export function isRetryableUnauthorizedFailure(failure: ImileBusinessFailure): boolean {
  if (failure.code === '22190') return true
  return /unauthorized data access/i.test(failure.message)
}

/**
 * iMile 登录态不可用：HTTP 仍是 200，靠 body 的 resultCode 表达，实测有两个码：
 * - 00018「Token失效」：token 曾有效但已过期
 * - 00002「Invalid access token: xxx」：token 不被识别（格式错/已作废）
 * 二者都意味着需要换 token，一并判定。
 * 与 22190（unauthorized data access，数据权限抖动，可重试）语义不同，勿混用。
 */
export function isImileTokenExpiredFailure(failure: ImileBusinessFailure): boolean {
  if (failure.code === '00018' || failure.code === '00002') return true
  return /token\s*失效/i.test(failure.message) || /invalid\s+(access\s+)?token/i.test(failure.message)
}

export function isRetryableBusyFailure(failure: ImileBusinessFailure): boolean {
  if (failure.code === '44882') return true
  return /system is busy/i.test(failure.message) || /系统繁忙/.test(failure.message)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
