import { useEffect, useRef } from 'react'
// 用 CSP 安全构建 + 独立 worker 文件；默认构建把 worker 代码内嵌成 blob 自解析，
// 和其它代码一起打进一个大 chunk 压缩后会报 "X is not defined"（worker 里的压缩变量名对不上主线程作用域）
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ADELAIDE_CENTER, DEFAULT_MAP_ZOOM, buildStatusPinIconUrl, trailColorForDriver } from './driverMapConstants'
import { buildPointInfoWindowHtml, ensureDriverMapInfoWindowStyles } from './driverMapInfoWindow'
import type { DriverMapDriver, DriverMapPointStatus } from './driverMapTypes'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

/** 免费无 Key 的 OpenStreetMap 矢量瓦片样式，永久免费无用量限制 */
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

const MARKER_SIZE = { numbered: 36, pending: 32 }

function createMarkerElement(status: DriverMapPointStatus, sequence?: number): HTMLDivElement {
  const size = status === 'pending' ? MARKER_SIZE.pending : MARKER_SIZE.numbered
  const el = document.createElement('div')
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.style.backgroundImage = `url("${buildStatusPinIconUrl(status, sequence)}")`
  el.style.backgroundSize = 'contain'
  el.style.cursor = 'pointer'
  return el
}

export function DriverMapView({ drivers }: { drivers: DriverMapDriver[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const trailLayerIdsRef = useRef<string[]>([])
  const popupRef = useRef<maplibregl.Popup | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    ensureDriverMapInfoWindowStyles()
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [ADELAIDE_CENTER.lng, ADELAIDE_CENTER.lat],
      zoom: DEFAULT_MAP_ZOOM,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map

    popupRef.current = new maplibregl.Popup({ maxWidth: '320px', closeButton: false })
    popupRef.current.on('open', () => {
      const btn = popupRef.current?.getElement()?.querySelector<HTMLButtonElement>('.dm-iw__close')
      if (!btn) return
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        popupRef.current?.remove()
      })
    })

    map.on('click', () => popupRef.current?.remove())

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const applyOverlays = () => {
      for (const marker of markersRef.current) marker.remove()
      markersRef.current = []
      for (const layerId of trailLayerIdsRef.current) {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(layerId)) map.removeSource(layerId)
      }
      trailLayerIdsRef.current = []

      const bounds = new maplibregl.LngLatBounds()
      let hasPoint = false

      for (const driver of drivers) {
        if (driver.points.length === 0) continue

        // 签收 + 问题件按时间顺序编号（与连线轨迹一致）；未签收不加号
        const trailPoints = driver.points.filter((p) => p.status !== 'pending')
        const sequenceByWaybill = new Map<string, number>()
        trailPoints.forEach((p, index) => {
          sequenceByWaybill.set(p.waybillNo, index + 1)
        })

        if (trailPoints.length > 1) {
          const sourceId = `dm-trail-${driver.courierCode}`
          map.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: trailPoints.map((p) => [p.lng, p.lat]) },
            },
          })
          map.addLayer({
            id: sourceId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': trailColorForDriver(driver.courierCode),
              'line-opacity': 0.85,
              'line-width': 3,
            },
          })
          trailLayerIdsRef.current.push(sourceId)
        }

        for (const point of driver.points) {
          const sequence = point.status === 'pending' ? undefined : sequenceByWaybill.get(point.waybillNo)
          const el = createMarkerElement(point.status, sequence)
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([point.lng, point.lat])
            .addTo(map)
          el.addEventListener('click', (e) => {
            e.stopPropagation()
            popupRef.current
              ?.setLngLat([point.lng, point.lat])
              .setHTML(
                buildPointInfoWindowHtml({
                  courierName: driver.courierName,
                  waybillNo: point.waybillNo,
                  status: point.status,
                  time: point.time,
                  address: point.address,
                  sequence,
                  problemReason: point.problemReason,
                }),
              )
              .addTo(map)
          })
          markersRef.current.push(marker)
          bounds.extend([point.lng, point.lat])
          hasPoint = true
        }
      }

      if (hasPoint) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 15 })
      }
    }

    if (map.isStyleLoaded()) applyOverlays()
    else map.once('load', applyOverlays)
  }, [drivers])

  return <div ref={containerRef} style={{ width: '100%', height: 480, borderRadius: 12 }} />
}
