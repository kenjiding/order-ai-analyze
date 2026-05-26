import { queryImileScanInterceptLogs, type ScanInterceptLog } from '../imile/interceptLogs'
import { queryImileTracks, type TrackEvent } from '../imile/track'

type CacheRow<T> = {
  value: T
  expiresAt: number
  updatedAt: number
}

const trackCache = new Map<string, CacheRow<TrackEvent[]>>()
const interceptCache = new Map<string, CacheRow<ScanInterceptLog[]>>()

function normalizeToken(raw: string): string {
  return raw.replace(/^Bearer\s+/i, '').trim()
}

function readCacheTtlMs(): number {
  const raw = Number.parseInt(
    String(process.env.ORDER_EXCEPTION_DATA_CACHE_TTL_MS ?? process.env.ORDER_EXCEPTION_TRACK_CACHE_TTL_MS ?? ''),
    10
  )
  if (!Number.isFinite(raw) || raw <= 0) return 5 * 60 * 1000
  return raw
}

function readCacheMaxEntries(): number {
  const raw = Number.parseInt(
    String(
      process.env.ORDER_EXCEPTION_DATA_CACHE_MAX_ENTRIES ??
        process.env.ORDER_EXCEPTION_TRACK_CACHE_MAX_ENTRIES ??
        ''
    ),
    10
  )
  if (!Number.isFinite(raw) || raw <= 0) return 3000
  return raw
}

function makeCacheKey(token: string, orderNo: string): string {
  return `${normalizeToken(token)}::${orderNo}`
}

function pruneCache<T>(cache: Map<string, CacheRow<T>>, now = Date.now()): void {
  for (const [key, row] of cache) {
    if (row.expiresAt <= now) cache.delete(key)
  }
  const maxEntries = readCacheMaxEntries()
  if (cache.size <= maxEntries) return
  const rows = Array.from(cache.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  const overflow = cache.size - maxEntries
  for (let i = 0; i < overflow; i += 1) {
    const key = rows[i]?.[0]
    if (key) cache.delete(key)
  }
}

function readFromCache<T>(
  cache: Map<string, CacheRow<T>>,
  token: string,
  orderNos: string[]
): { hits: Record<string, T>; missingOrderNos: string[] } {
  const now = Date.now()
  pruneCache(cache, now)
  const hits: Record<string, T> = {}
  const missingOrderNos: string[] = []
  for (const orderNo of orderNos) {
    const row = cache.get(makeCacheKey(token, orderNo))
    if (!row || row.expiresAt <= now) {
      missingOrderNos.push(orderNo)
      continue
    }
    hits[orderNo] = row.value
  }
  return { hits, missingOrderNos }
}

function writeToCache<T>(cache: Map<string, CacheRow<T>>, token: string, values: Record<string, T>): void {
  const ttlMs = readCacheTtlMs()
  const now = Date.now()
  for (const [orderNo, value] of Object.entries(values)) {
    cache.set(makeCacheKey(token, orderNo), {
      value,
      expiresAt: now + ttlMs,
      updatedAt: now,
    })
  }
  pruneCache(cache, now)
}

type FetchCacheOptions = {
  /** 为 true 时不读缓存、始终走 iMile（用于 /analyze，保证 AI 输入为最新轨迹/阻断） */
  freshForAi?: boolean
}

export async function queryTracksWithCache(
  token: string,
  orderNos: string[],
  options?: FetchCacheOptions
) {
  const dedupedOrderNos = Array.from(new Set(orderNos))
  const hitTrackInfo: Record<string, TrackEvent[]> = {}
  const missingOrderNos = options?.freshForAi
    ? [...dedupedOrderNos]
    : (() => {
        const { hits, missingOrderNos: missing } = readFromCache(trackCache, token, dedupedOrderNos)
        Object.assign(hitTrackInfo, hits)
        return missing
      })()

  if (!missingOrderNos.length) {
    return { ok: true as const, trackInfo: hitTrackInfo, raw: { cacheOnly: true } }
  }

  const fetched = await queryImileTracks(token, missingOrderNos)
  if (!fetched.ok) return fetched

  writeToCache(trackCache, token, fetched.trackInfo)
  const merged: Record<string, TrackEvent[]> = {}
  for (const orderNo of dedupedOrderNos) {
    merged[orderNo] = hitTrackInfo[orderNo] ?? fetched.trackInfo[orderNo] ?? []
  }
  return {
    ok: true as const,
    trackInfo: merged,
    raw: {
      cacheHitCount: Object.keys(hitTrackInfo).length,
      fetchedCount: missingOrderNos.length,
      fetchedRaw: fetched.raw,
      freshForAi: Boolean(options?.freshForAi),
    },
  }
}

export async function queryInterceptLogsWithCache(
  token: string,
  orderNos: string[],
  options?: FetchCacheOptions
) {
  const dedupedOrderNos = Array.from(new Set(orderNos))
  const hitInterceptLogs: Record<string, ScanInterceptLog[]> = {}
  const missingOrderNos = options?.freshForAi
    ? [...dedupedOrderNos]
    : (() => {
        const { hits, missingOrderNos: missing } = readFromCache(interceptCache, token, dedupedOrderNos)
        Object.assign(hitInterceptLogs, hits)
        return missing
      })()

  if (!missingOrderNos.length) {
    return {
      ok: true as const,
      interceptLogs: hitInterceptLogs,
      raw: { cacheOnly: true },
      errors: [] as { orderNo: string; message: string }[],
    }
  }

  const fetched = await queryImileScanInterceptLogs(token, missingOrderNos)
  if (!fetched.ok) return fetched

  const fetchedLogs: Record<string, ScanInterceptLog[]> = {}
  for (const orderNo of missingOrderNos) {
    fetchedLogs[orderNo] = fetched.interceptLogs[orderNo] ?? []
  }
  writeToCache(interceptCache, token, fetchedLogs)

  const merged: Record<string, ScanInterceptLog[]> = {}
  for (const orderNo of dedupedOrderNos) {
    merged[orderNo] = hitInterceptLogs[orderNo] ?? fetched.interceptLogs[orderNo] ?? []
  }

  return {
    ok: true as const,
    interceptLogs: merged,
    raw: {
      cacheHitCount: Object.keys(hitInterceptLogs).length,
      fetchedCount: missingOrderNos.length,
      fetchedRaw: fetched.raw,
      freshForAi: Boolean(options?.freshForAi),
    },
    errors: fetched.errors,
  }
}

export type OrderExceptionPrefetchMeta = {
  trackCacheHitCount: number
  trackFetchedCount: number
  interceptCacheHitCount: number
  interceptFetchedCount: number
  interceptErrors: { orderNo: string; message: string }[]
}

/** 并行预取轨迹与阻断并写入缓存；不调用 AI。供批量分析前预热。 */
export async function prefetchOrderExceptionData(
  token: string,
  orderNos: string[]
): Promise<
  | {
      ok: true
      trackInfo: Record<string, TrackEvent[]>
      interceptLogs: Record<string, ScanInterceptLog[]>
      meta: OrderExceptionPrefetchMeta
    }
  | { ok: false; message: string; status?: number; rawText?: string }
> {
  const dedupedOrderNos = Array.from(new Set(orderNos))
  const [trackResult, interceptResult] = await Promise.all([
    queryTracksWithCache(token, dedupedOrderNos),
    queryInterceptLogsWithCache(token, dedupedOrderNos),
  ])

  if (!trackResult.ok) {
    return {
      ok: false,
      message: trackResult.message,
      status: trackResult.status,
      rawText: trackResult.rawText,
    }
  }

  const trackRaw = trackResult.raw && typeof trackResult.raw === 'object' ? trackResult.raw : {}
  const interceptRaw =
    interceptResult.ok && interceptResult.raw && typeof interceptResult.raw === 'object'
      ? interceptResult.raw
      : {}

  const meta: OrderExceptionPrefetchMeta = {
    trackCacheHitCount: Number((trackRaw as { cacheHitCount?: number }).cacheHitCount ?? 0),
    trackFetchedCount: Number((trackRaw as { fetchedCount?: number }).fetchedCount ?? 0),
    interceptCacheHitCount: Number((interceptRaw as { cacheHitCount?: number }).cacheHitCount ?? 0),
    interceptFetchedCount: Number((interceptRaw as { fetchedCount?: number }).fetchedCount ?? 0),
    interceptErrors: interceptResult.ok ? interceptResult.errors : [],
  }

  if (!interceptResult.ok) {
    console.warn('阻断日志预取失败，轨迹已缓存:', interceptResult.message)
    const interceptLogs: Record<string, ScanInterceptLog[]> = {}
    for (const orderNo of dedupedOrderNos) interceptLogs[orderNo] = []
    return { ok: true, trackInfo: trackResult.trackInfo, interceptLogs, meta }
  }

  if (interceptResult.errors.length) {
    console.warn('部分阻断日志预取失败:', interceptResult.errors)
  }

  return {
    ok: true,
    trackInfo: trackResult.trackInfo,
    interceptLogs: interceptResult.interceptLogs,
    meta,
  }
}

/**
 * 分析前拉数：轨迹与阻断并行；默认 freshForAi，保证送入 AI 的为最新 iMile 数据。
 * AI pipeline / guardrail / 交叉验证逻辑不变。
 */
export async function fetchOrderExceptionSourcesForAnalyze(
  token: string,
  orderNos: string[]
): Promise<
  | {
      ok: true
      trackInfo: Record<string, TrackEvent[]>
      interceptLogs: Record<string, ScanInterceptLog[]>
      interceptErrors: { orderNo: string; message: string }[]
    }
  | { ok: false; message: string; status?: number; rawText?: string }
> {
  const dedupedOrderNos = Array.from(new Set(orderNos))
  const freshOpts: FetchCacheOptions = { freshForAi: true }

  const [trackResult, interceptResult] = await Promise.all([
    queryTracksWithCache(token, dedupedOrderNos, freshOpts),
    queryInterceptLogsWithCache(token, dedupedOrderNos, freshOpts),
  ])

  if (!trackResult.ok) {
    return {
      ok: false,
      message: trackResult.message,
      status: trackResult.status,
      rawText: trackResult.rawText,
    }
  }

  if (!interceptResult.ok) {
    console.warn('阻断日志获取失败，继续按轨迹分析:', interceptResult.message)
    const interceptLogs: Record<string, ScanInterceptLog[]> = {}
    for (const orderNo of dedupedOrderNos) interceptLogs[orderNo] = []
    return {
      ok: true,
      trackInfo: trackResult.trackInfo,
      interceptLogs,
      interceptErrors: [],
    }
  }

  if (interceptResult.errors.length) {
    console.warn('部分阻断日志获取失败，继续按可用数据分析:', interceptResult.errors)
  }

  return {
    ok: true,
    trackInfo: trackResult.trackInfo,
    interceptLogs: interceptResult.interceptLogs,
    interceptErrors: interceptResult.errors,
  }
}
