/** iMile 开放平台 HTTP 调用公共能力（轨迹、阻断日志等接口共用）。业务模块请通过 client.requestImileApi 发请求，勿直接调用 imileRequestJson。 */

import { AsyncLocalStorage } from 'node:async_hooks'

export const IMILE_DEFAULT_FRONT_SEC = JSON.stringify({
  orgId: 10,
  entId: 10,
  moduleId: 10007,
  client: 'pc',
})

export const IMILE_DEFAULT_HUBCODE = 'S210431701'
export const IMILE_DEFAULT_LANG = 'zh_CN'
export const IMILE_DEFAULT_TIMEZONE = '+10'

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

export function buildImileAuthHeaders(config: ImileAuthHeaderConfig): Record<string, string> {
  const token = normalizeImileToken(config.token)
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${token}`,
    'front-sec': envFirst(...(config.frontSecEnvKeys ?? [])) ?? IMILE_DEFAULT_FRONT_SEC,
    hubcode:
      getRequestImileHubcode() || envFirst(...(config.hubcodeEnvKeys ?? [])) || IMILE_DEFAULT_HUBCODE,
    lang: envFirst(...(config.langEnvKeys ?? [])) ?? IMILE_DEFAULT_LANG,
    timezone: envFirst(...(config.timezoneEnvKeys ?? [])) ?? IMILE_DEFAULT_TIMEZONE,
    'resource-code': config.resourceCode,
    'sys-name': config.sysName,
    'sys-portal': config.sysPortal,
    Origin: config.origin,
    Referer: config.referer,
    ...config.extra,
  }

  const cookie = envFirst(...(config.cookieEnvKeys ?? []))
  if (cookie) headers.Cookie = cookie
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

export function isRetryableBusyFailure(failure: ImileBusinessFailure): boolean {
  if (failure.code === '44882') return true
  return /system is busy/i.test(failure.message) || /系统繁忙/.test(failure.message)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
