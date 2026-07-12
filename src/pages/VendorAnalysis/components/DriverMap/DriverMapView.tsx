import { useEffect, useRef } from 'react'
import { ADELAIDE_CENTER, DEFAULT_MAP_ZOOM, buildStatusPinIconUrl, trailColorForDriver } from './driverMapConstants'
import { buildPointInfoWindowHtml, ensureDriverMapInfoWindowStyles } from './driverMapInfoWindow'
import type { DriverMapDriver, DriverMapPointStatus } from './driverMapTypes'

const MARKER_SIZE = { numbered: 36, pending: 32 }

function markerIcon(status: DriverMapPointStatus, sequence?: number): google.maps.Icon {
  const size = status === 'pending' ? MARKER_SIZE.pending : MARKER_SIZE.numbered
  return {
    url: buildStatusPinIconUrl(status, sequence),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  }
}

export function DriverMapView({ drivers }: { drivers: DriverMapDriver[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<Array<google.maps.Marker | google.maps.Polyline>>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    ensureDriverMapInfoWindowStyles()
    mapRef.current = new google.maps.Map(containerRef.current, {
      center: ADELAIDE_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    })
    infoWindowRef.current = new google.maps.InfoWindow({
      maxWidth: 320,
      // 去掉默认标题栏；关闭改用卡片内自定义按钮
      headerDisabled: true,
    } as google.maps.InfoWindowOptions)

    // 自定义关闭按钮（headerDisabled 后没有默认 X）
    infoWindowRef.current.addListener('domready', () => {
      const btn = document.querySelector<HTMLButtonElement>('.dm-iw__close')
      if (!btn || btn.dataset.bound === '1') return
      btn.dataset.bound = '1'
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        infoWindowRef.current?.close()
      })
    })

    // 点击地图空白处关闭
    mapRef.current.addListener('click', () => {
      infoWindowRef.current?.close()
    })
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const overlay of overlaysRef.current) overlay.setMap(null)
    overlaysRef.current = []

    const bounds = new google.maps.LatLngBounds()
    let hasPoint = false

    for (const driver of drivers) {
      if (driver.points.length === 0) continue

      // 签收 + 问题件按时间顺序编号（与连线轨迹一致）；未签收不加号
      const trailPoints = driver.points.filter((p) => p.status !== 'pending')
      const sequenceByWaybill = new Map<string, number>()
      trailPoints.forEach((p, index) => {
        sequenceByWaybill.set(p.waybillNo, index + 1)
      })

      const path = trailPoints.map((p) => ({ lat: p.lat, lng: p.lng }))
      if (path.length > 1) {
        const polyline = new google.maps.Polyline({
          path,
          strokeColor: trailColorForDriver(driver.courierCode),
          strokeOpacity: 0.85,
          strokeWeight: 3,
          map,
        })
        overlaysRef.current.push(polyline)
      }

      for (const point of driver.points) {
        const sequence = point.status === 'pending' ? undefined : sequenceByWaybill.get(point.waybillNo)
        const marker = new google.maps.Marker({
          position: { lat: point.lat, lng: point.lng },
          map,
          title:
            sequence != null
              ? `${sequence}. ${driver.courierName} · ${point.waybillNo}`
              : `${driver.courierName} · ${point.waybillNo}`,
          icon: markerIcon(point.status, sequence),
          optimized: true,
          zIndex: point.status === 'pending' ? 1 : 2 + (sequence ?? 0),
        })
        marker.addListener('click', () => {
          infoWindowRef.current?.setContent(
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
          infoWindowRef.current?.open({ map, anchor: marker })
        })
        overlaysRef.current.push(marker)
        bounds.extend({ lat: point.lat, lng: point.lng })
        hasPoint = true
      }
    }

    if (hasPoint) {
      map.fitBounds(bounds, 48)
      const listener = google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
        const z = map.getZoom()
        if (typeof z === 'number' && z > 15) map.setZoom(15)
      })
      return () => {
        google.maps.event.removeListener(listener)
      }
    }
  }, [drivers])

  return <div ref={containerRef} style={{ width: '100%', height: 480, borderRadius: 12 }} />
}
