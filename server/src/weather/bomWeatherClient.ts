import { envFirst, envFirstOr, sleep } from '../imile/shared'
import { encodeGeohash } from './geohash'
import type { BomDailyForecast } from './types'

const DEFAULT_BASE = 'https://api.weather.bom.gov.au/v1'
const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000
// BOM 的 WAF 偶发对某次请求静默挂连接（tarpit）→ 超时；重试一次通常即可自愈
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 500
// BOM 的 WAF 会拦截/挂起爬虫特征的 UA（含 "Bot"/URL 会被 tarpit 静默挂连接），
// 必须使用普通浏览器 UA 才能正常获取。
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

type CacheEntry = { data: BomDailyForecast[]; expireAt: number }
const cache = new Map<string, CacheEntry>()

function ttlMs(): number {
  const raw = envFirst('WEATHER_CACHE_TTL_MS')
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CACHE_TTL_MS
}

function timeoutMs(): number {
  const raw = envFirst('WEATHER_FETCH_TIMEOUT_MS')
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

const LABEL = '[weather/bom]'

/** 单次请求：成功返回预报；'retry'=可重试（超时/网络/5xx）；null=不可重试（4xx/坏 JSON） */
async function fetchOnce(url: string, geohash: string): Promise<BomDailyForecast[] | 'retry' | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs())
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      // 5xx 可重试；4xx（如 geohash 不存在）重试无益
      console.warn(`${LABEL} 请求失败 status=${res.status} geohash=${geohash}`)
      return res.status >= 500 ? 'retry' : null
    }
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null
    const data = json?.data
    if (!Array.isArray(data)) {
      console.warn(`${LABEL} 响应无 data 数组 geohash=${geohash}`)
      return null
    }
    return data as BomDailyForecast[]
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? '超时' : String(err)
    console.warn(`${LABEL} 请求异常 geohash=${geohash}: ${reason}`)
    return 'retry'
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 获取指定坐标的 BOM 每日预报（data[0]=今天，data[1]=明天，data[2]=后天…）。
 * 对瞬时失败（WAF tarpit 超时/网络/5xx）自动重试；天气是增强信息，最终失败返回 null，
 * 不得阻断主推送。
 */
export async function fetchBomDailyForecast(
  lat: number,
  lng: number,
): Promise<BomDailyForecast[] | null> {
  const geohash = encodeGeohash(lat, lng, 6)

  const cached = cache.get(geohash)
  if (cached && cached.expireAt > Date.now()) return cached.data

  const base = envFirstOr(['BOM_API_BASE'], DEFAULT_BASE).replace(/\/$/, '')
  const url = `${base}/locations/${geohash}/forecasts/daily`

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await fetchOnce(url, geohash)
    if (Array.isArray(result)) {
      cache.set(geohash, { data: result, expireAt: Date.now() + ttlMs() })
      return result
    }
    if (result === null) return null // 不可重试
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`${LABEL} 第 ${attempt}/${MAX_ATTEMPTS} 次失败，${RETRY_DELAY_MS}ms 后重试 geohash=${geohash}`)
      await sleep(RETRY_DELAY_MS)
    }
  }
  console.warn(`${LABEL} 重试 ${MAX_ATTEMPTS} 次仍失败 geohash=${geohash}`)
  return null
}
