import { useEffect, useRef } from 'react'
// 复用司机地图同款 CSP 构建写法：worker 代码不内嵌进主 chunk，避免压缩后变量名对不上
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ADELAIDE_CENTER, DEFAULT_MAP_ZOOM } from '../../components/DriverMap/driverMapConstants'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

/** 免费无 Key 的 OpenStreetMap 矢量瓦片样式，与司机地图共用同一套 */
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

export type AddressVerifyMapStatus = 'match' | 'mismatch' | 'unresolved'

const STATUS_COLORS: Record<AddressVerifyMapStatus, string> = {
  match: '#16a34a',
  mismatch: '#dc2626',
  unresolved: '#f59e0b',
}

export type AddressVerifyMapPoint = {
  orderNo: string
  latitude: number
  longitude: number
  status: AddressVerifyMapStatus
  merchantName: string
  consigneeAddress: string
  consigneeZipCode: string
  resolvedPostcode: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildPopupHtml(p: AddressVerifyMapPoint): string {
  return `<div style="font-size:12px;line-height:1.6;max-width:260px">
    <div style="font-weight:600">${escapeHtml(p.orderNo)}</div>
    <div>${escapeHtml(p.merchantName)}</div>
    <div>${escapeHtml(p.consigneeAddress)}</div>
    <div>反查邮编：${escapeHtml(p.resolvedPostcode || '—')}　运单邮编：${escapeHtml(p.consigneeZipCode || '—')}</div>
  </div>`
}

export function AddressVerifyMapView({ points }: { points: AddressVerifyMapPoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [ADELAIDE_CENTER.lng, ADELAIDE_CENTER.lat],
      zoom: DEFAULT_MAP_ZOOM,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const render = () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      if (points.length === 0) return

      const bounds = new maplibregl.LngLatBounds()
      for (const p of points) {
        const el = document.createElement('div')
        el.style.width = '16px'
        el.style.height = '16px'
        el.style.borderRadius = '50%'
        el.style.border = '2px solid #fff'
        el.style.boxShadow = '0 0 2px rgba(0,0,0,0.4)'
        el.style.background = STATUS_COLORS[p.status]
        el.style.cursor = 'pointer'
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.longitude, p.latitude])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(buildPopupHtml(p)))
          .addTo(map)
        markersRef.current.push(marker)
        bounds.extend([p.longitude, p.latitude])
      }
      map.fitBounds(bounds, { padding: 48, maxZoom: 15 })
    }

    if (map.isStyleLoaded()) render()
    else map.once('load', render)
  }, [points])

  return <div ref={containerRef} style={{ width: '100%', height: 480, borderRadius: 12 }} />
}
