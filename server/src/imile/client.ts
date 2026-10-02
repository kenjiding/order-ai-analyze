import {
  imileRequestJson,
  isRetryableBusyFailure,
  readImileBusinessFailure,
  sleep,
  truncateRawText,
  type ImileBusinessFailure,
} from './shared'

/** 首次重试的基础延迟；实际延迟按 2^attempt 指数增长，见 busyRetryMaxDelayMs 封顶 */
const DEFAULT_BUSY_RETRY_DELAY_MS = 2000
const DEFAULT_BUSY_RETRY_MAX = 5
/** 单次退避延迟上限：避免指数增长在大批量场景下把单次请求拖太久 */
const DEFAULT_BUSY_RETRY_MAX_DELAY_MS = 32000

/** 单次请求内的重试退避、熔断开启时长共用同一套「基数 × 2^n，封顶」公式，抽成一个函数避免两处各写一遍 */
function exponentialBackoffMs(baseMs: number, exponent: number, capMs: number): number {
  return Math.min(baseMs * 2 ** exponent, capMs)
}

/**
 * 熔断器：按 URL 记账，独立于业务层的每分钟 cron 补跑。
 * 目的是在 iMile 持续繁忙时，把「4~5 路 cron 各自每分钟重试」收敛成「几分钟探测一次」，
 * 避免像 2026-09-30 那次事故一样，全天以每分钟 x 5 次重试的频率持续冲击同一个接口。
 * 进程内内存态即可：warehouse-worker 是所有 cron 的唯一进程，天然共享这份状态；
 * warehouse-server（手动「立刻推送」）是独立进程，各自维护一份，互不影响。
 */
type CircuitState = { consecutiveFailures: number; openUntil: number; openStreak: number }
const circuitBreakers = new Map<string, CircuitState>()
/** 连续「繁忙耗尽重试」达到这个次数才熔断，避免偶发抖动被一棍子打死 */
const CIRCUIT_FAIL_THRESHOLD = 3
const CIRCUIT_OPEN_BASE_MS = 3 * 60_000
/** 熔断时长按 openStreak 指数扩大（3→6→12→…），封顶 15 分钟，避免长时间故障时还在高频探测 */
const CIRCUIT_OPEN_MAX_MS = 15 * 60_000

function getCircuit(url: string): CircuitState {
  let state = circuitBreakers.get(url)
  if (!state) {
    state = { consecutiveFailures: 0, openUntil: 0, openStreak: 0 }
    circuitBreakers.set(url, state)
  }
  return state
}

/** 仅供单测使用：直接摆弄某个 URL 的熔断状态，绕开真实的分钟级等待 */
export function __setCircuitStateForTest(url: string, patch: Partial<CircuitState>): void {
  Object.assign(getCircuit(url), patch)
}

function recordImileSuccess(url: string): void {
  const state = circuitBreakers.get(url)
  if (!state) return
  state.consecutiveFailures = 0
  state.openUntil = 0
  state.openStreak = 0
}

function recordImileBusyFailure(url: string, label: string): void {
  const state = getCircuit(url)
  state.consecutiveFailures += 1
  // 已经跳闸过一次，说明不是偶发抖动：冷却期一过还失败，立刻重新熔断，不用再攒够 3 次
  // 门槛（否则故障持续期间每次续熔断都要先自费一整轮真实重试去验证，起不到收敛流量的作用）
  const threshold = state.openStreak > 0 ? 1 : CIRCUIT_FAIL_THRESHOLD
  if (state.consecutiveFailures < threshold) return
  const openMs = exponentialBackoffMs(CIRCUIT_OPEN_BASE_MS, state.openStreak, CIRCUIT_OPEN_MAX_MS)
  state.openUntil = Date.now() + openMs
  state.openStreak += 1
  state.consecutiveFailures = 0
  console.warn(
    `[imile-client] ${label} 连续 ${CIRCUIT_FAIL_THRESHOLD} 次繁忙重试耗尽，熔断 ${Math.round(openMs / 1000)}s：${url}`,
  )
}

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
  busyRetryMaxDelayMs?: number
  timeoutMs?: number
}): Promise<ImileClientSuccess | ImileClientError> {
  const retryBusy = options.retryBusy ?? true
  const busyRetryDelayMs = options.busyRetryDelayMs ?? DEFAULT_BUSY_RETRY_DELAY_MS
  const busyRetryMax = options.busyRetryMax ?? DEFAULT_BUSY_RETRY_MAX
  const busyRetryMaxDelayMs = options.busyRetryMaxDelayMs ?? DEFAULT_BUSY_RETRY_MAX_DELAY_MS
  const body =
    options.body == null || options.method === 'GET' ? undefined : JSON.stringify(options.body)

  const circuit = getCircuit(options.url)
  if (Date.now() < circuit.openUntil) {
    const remainingSec = Math.ceil((circuit.openUntil - Date.now()) / 1000)
    return {
      ok: false,
      status: 503,
      message: `${options.label}熔断中：iMile 接口持续繁忙，约 ${remainingSec}s 后恢复探测`,
    }
  }

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
        const backoffMs = exponentialBackoffMs(busyRetryDelayMs, attempt, busyRetryMaxDelayMs)
        await sleep(backoffMs)
        continue
      }
      if (isRetryableBusyFailure(failure)) {
        recordImileBusyFailure(options.url, options.label)
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

    recordImileSuccess(options.url)
    return { ok: true, json: res.json, text: res.text }
  }

  return { ok: false, status: 502, message: `${options.label}重试耗尽` }
}
