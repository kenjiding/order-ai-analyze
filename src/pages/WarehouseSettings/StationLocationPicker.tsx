import { useEffect, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { MapPin } from 'lucide-react'
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTranslation } from 'react-i18next'
import { backendFetch } from '../../api/httpClient'
import { showToast } from '../../utils/toast'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const DEFAULT_ZOOM = 9
const PINNED_ZOOM = 13

export type LocationValue = {
  address: string
  lat: number | null
  lng: number | null
}

type GeocodeResult = { displayName: string; lat: number; lng: number }

async function geocode(address: string): Promise<{ ok: true; data: GeocodeResult[] } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(`/api/geocoding/search?q=${encodeURIComponent(address)}`)
    const json = (await res.json()) as { ok?: boolean; data?: GeocodeResult[]; error?: string }
    if (json.ok === true) return { ok: true, data: json.data ?? [] }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '' }
  } catch {
    return { ok: false, error: '' }
  }
}

type Props = {
  value: LocationValue
  onChange: (value: LocationValue) => void
  defaultCenter: { lat: number; lng: number }
}

/**
 * 地址文本 → 「定位」调地理编码给个初始坐标 → 地图上的 marker 允许拖动微调。
 * 运营不需要看懂经纬度数字：搜地址、看地图上的针对不对、不对就拖一下。
 */
export function StationLocationPicker({ value, onChange, defaultCenter }: Props) {
  const { t } = useTranslation('warehouseSettings')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [geocoding, setGeocoding] = useState(false)

  // 给事件回调用的「最新值」镜像，避免 marker 只在创建时捕获一份旧的 value/onChange 闭包
  const latestRef = useRef({ value, onChange })
  useEffect(() => {
    latestRef.current = { value, onChange }
  })

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const hasPin = value.lat != null && value.lng != null
    const center = hasPin ? { lat: value.lat!, lng: value.lng! } : defaultCenter
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [center.lng, center.lat],
      zoom: hasPin ? PINNED_ZOOM : DEFAULT_ZOOM,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    // 地理编码找不到或不准时，允许直接在地图上点一下把坐标定在那——不用非得先搜出个结果才能拖
    map.on('click', (e) => {
      const { value: current, onChange: currentOnChange } = latestRef.current
      currentOnChange({ ...current, lat: e.lngLat.lat, lng: e.lngLat.lng })
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // 地图只建一次；后续 value 变化靠下面这个 effect 同步 marker 位置，不重建地图
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (value.lat == null || value.lng == null) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }

    if (!markerRef.current) {
      const marker = new maplibregl.Marker({ draggable: true }).setLngLat([value.lng, value.lat]).addTo(map)
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLngLat()
        const { value: current, onChange: currentOnChange } = latestRef.current
        currentOnChange({ ...current, lat, lng })
      })
      markerRef.current = marker
    } else {
      markerRef.current.setLngLat([value.lng, value.lat])
    }

    const targetZoom = Math.max(map.getZoom(), PINNED_ZOOM)
    map.flyTo({ center: [value.lng, value.lat], zoom: targetZoom, duration: 600 })
  }, [value.lat, value.lng])

  const handleGeocode = async () => {
    const address = value.address.trim()
    if (!address) {
      showToast(t('addressRequired'), 'warning')
      return
    }
    setGeocoding(true)
    const res = await geocode(address)
    setGeocoding(false)
    if (!res.ok) {
      showToast(res.error || t('geocodeFailed'), 'error')
      return
    }
    if (res.data.length === 0) {
      showToast(t('geocodeNoResult'), 'warning')
      return
    }
    const first = res.data[0]!
    onChange({ ...value, lat: first.lat, lng: first.lng })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          placeholder={t('addressPlaceholder')}
          onPressEnter={() => void handleGeocode()}
        />
        <Button icon={<MapPin className="h-4 w-4" aria-hidden />} loading={geocoding} onClick={() => void handleGeocode()}>
          {t('locate')}
        </Button>
      </div>
      <p className="text-xs text-slate-400">{t('locateHint')}</p>
      <div ref={containerRef} className="h-72 w-full overflow-hidden rounded-lg border border-slate-200" />
      <p className="text-xs text-slate-500">
        {value.lat != null && value.lng != null
          ? t('coordsResolved', { lat: value.lat.toFixed(5), lng: value.lng.toFixed(5) })
          : t('coordsUnresolved')}
      </p>
    </div>
  )
}
