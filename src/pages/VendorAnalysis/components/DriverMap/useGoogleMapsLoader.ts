import { useEffect, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

type LoaderState = { status: 'loading' } | { status: 'ready' } | { status: 'no-key' } | { status: 'error'; message: string }

let sharedLoaderPromise: Promise<void> | null = null

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (!sharedLoaderPromise) {
    setOptions({ key: apiKey, v: 'weekly', libraries: ['maps', 'marker'] })
    sharedLoaderPromise = importLibrary('maps').then(() => undefined)
  }
  return sharedLoaderPromise
}

/**
 * 加载 Google Maps JS SDK。apiKey 为 null/undefined 时视为"尚未拿到 key"，不发起任何 SDK 请求
 * （key 的获取方式由调用方决定：内部授权页面走 /api/driver-map/maps-key，外部分享链接门户走
 * 门户自己的公开接口，两者共用同一个 SDK 加载逻辑）。
 */
type LoadOutcome = { status: 'ready' } | { status: 'error'; message: string }

export function useGoogleMapsLoader(apiKey: string | null | undefined): LoaderState {
  const [loadOutcome, setLoadOutcome] = useState<LoadOutcome | null>(null)

  useEffect(() => {
    if (!apiKey) return
    let cancelled = false
    void (async () => {
      try {
        await loadGoogleMaps(apiKey)
        if (!cancelled) setLoadOutcome({ status: 'ready' })
      } catch (err) {
        if (!cancelled) setLoadOutcome({ status: 'error', message: err instanceof Error ? err.message : '地图加载失败' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiKey])

  if (apiKey === undefined) return { status: 'loading' } // 上层还在加载 key 本身
  if (!apiKey) return { status: 'no-key' }
  return loadOutcome ?? { status: 'loading' }
}
