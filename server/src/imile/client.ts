import {
  imileRequestJson,
  isRetryableBusyFailure,
  readImileBusinessFailure,
  sleep,
  truncateRawText,
  type ImileBusinessFailure,
} from './shared'

const DEFAULT_BUSY_RETRY_DELAY_MS = 1500
const DEFAULT_BUSY_RETRY_MAX = 3

export type ImileClientError = {
  ok: false
  status: number
  message: string
  rawText?: string
  /** 业务失败时的原始错误码与文案，供调用方做 unauthorized 等分支判断 */
  businessFailure?: ImileBusinessFailure
  networkError?: boolean
}

export type ImileClientSuccess = {
  ok: true
  json: unknown
  text: string
}

export async function requestImileApi(options: {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: unknown
  /** 错误信息前缀，如「到件查询」 */
  label: string
  retryBusy?: boolean
  busyRetryDelayMs?: number
  busyRetryMax?: number
  timeoutMs?: number
}): Promise<ImileClientSuccess | ImileClientError> {
  const retryBusy = options.retryBusy ?? true
  const busyRetryDelayMs = options.busyRetryDelayMs ?? DEFAULT_BUSY_RETRY_DELAY_MS
  const busyRetryMax = options.busyRetryMax ?? DEFAULT_BUSY_RETRY_MAX
  const body =
    options.body == null || options.method === 'GET' ? undefined : JSON.stringify(options.body)

  for (let attempt = 0; attempt <= (retryBusy ? busyRetryMax : 0); attempt += 1) {
    const res = await imileRequestJson({
      url: options.url,
      method: options.method,
      headers: options.headers,
      body,
      timeoutMs: options.timeoutMs,
    })

    if (!res.readOk) {
      return {
        ok: false,
        status: res.status,
        message: res.networkError
          ? `${options.label}请求失败：${res.text}`
          : `${options.label}接口返回非 JSON`,
        rawText: truncateRawText(res.text),
        networkError: res.networkError,
      }
    }

    const failure = readImileBusinessFailure(res.json)
    if (failure) {
      if (retryBusy && isRetryableBusyFailure(failure) && attempt < busyRetryMax) {
        await sleep(busyRetryDelayMs)
        continue
      }
      return {
        ok: false,
        status: res.status,
        message: `${options.label}业务失败：${failure.message}`,
        rawText: truncateRawText(res.text),
        businessFailure: failure,
      }
    }

    if (!res.httpOk) {
      return {
        ok: false,
        status: res.status,
        message: `${options.label} HTTP 错误`,
        rawText: truncateRawText(res.text),
      }
    }

    return { ok: true, json: res.json, text: res.text }
  }

  return { ok: false, status: 502, message: `${options.label}重试耗尽` }
}
