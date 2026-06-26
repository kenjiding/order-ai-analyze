const CACHE_TTL_MS = 30 * 60 * 1000

const cache = new Map<string, { data: unknown[]; expiresAt: number }>()

export function makeWaybillCacheKey(token: string, startTime: string, endTime: string): string {
  return `${token.slice(-8)}:${startTime}:${endTime}`
}

export function getCachedWaybills(key: string): unknown[] | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data
}

export function setCachedWaybills(key: string, data: unknown[]): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}
