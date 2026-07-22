const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 500

export type FeishuFetchResult =
  | { ok: true; httpStatus: number; json: unknown }
  | { ok: false; error: string }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 429（限流）与 5xx 视为瞬时故障，值得重试；其余 4xx 是业务/参数错误，重试没有意义 */
function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * 服务端对飞书开放接口（tenant_access_token / 图片上传 / webhook 推送）统一的请求方式：
 * 每次请求带超时（默认 15s），超时或网络错误按指数退避重试；HTTP 429/5xx 同样重试；
 * 其余响应（含飞书业务 code 非 0）原样返回，由调用方判断——业务失败重试没有意义。
 */
export async function fetchFeishuJson(
  url: string,
  init: RequestInit,
  options?: { timeoutMs?: number; maxRetries?: number },
): Promise<FeishuFetchResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES

  let lastError = '未知错误'
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)

      if (isRetryableHttpStatus(res.status) && attempt < maxRetries) {
        lastError = `飞书接口 HTTP ${res.status}`
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
        continue
      }

      let json: unknown
      try {
        json = await res.json()
      } catch {
        json = await res.text().catch(() => '')
      }
      return { ok: true, httpStatus: res.status, json }
    } catch (err) {
      clearTimeout(timer)
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      lastError = isTimeout ? `飞书接口请求超时（${timeoutMs}ms）` : err instanceof Error ? err.message : String(err)
      if (attempt < maxRetries) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
        continue
      }
    }
  }
  return { ok: false, error: lastError }
}
