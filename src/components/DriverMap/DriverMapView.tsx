import { useEffect, useRef } from 'react'
// 用 CSP 安全构建 + 独立 worker 文件；默认构建把 worker 代码内嵌成 blob 自解析，
// 和其它代码一起打进一个大 chunk 压缩后会报 "X is not defined"（worker 里的压缩变量名对不上主线程作用域）
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ADELAIDE_CENTER, DEFAULT_MAP_ZOOM, buildStatusPinIconUrl, trailColorForDriver } from './driverMapConstants'
import { buildPointInfoWindowHtml, ensureDriverMapInfoWindowStyles } from './driverMapInfoWindow'
import type { DriverMapDriver, DriverMapPointStatus } from './driverMapTypes'
import type { Feature, FeatureCollection } from 'geojson'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

/** 免费无 Key 的 OpenStreetMap 矢量瓦片样式，永久免费无用量限制 */
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

const POINTS_SOURCE_ID = 'dm-points'
const TRAILS_SOURCE_ID = 'dm-trails'
const POINTS_LAYER_ID = 'dm-points-layer'
const TRAILS_LAYER_ID = 'dm-trails-layer'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

function sequenceLabelOf(sequence: number | undefined): string {
  if (sequence == null) return ''
  return sequence > 999 ? '999+' : String(sequence)
}

/** 数字烤进图标图片本身（而不是叠加独立的 text-field）：
 * symbol 图层里图标和文字是分两批渲染的（图层内所有图标先画一遍，所有文字再叠一遍），
 * 近处点位完全遮住远处点位的图标后，远处点位的数字仍会在文字批次里透出来。
 * 按 status+编号 缓存复用图标（不是按点位数量），同一天几千上万点位里不同的
 * status+编号 组合通常只有几十到一两百种，注册成本可忽略。 */
function iconIdOf(status: DriverMapPointStatus, sequence: number | undefined): string {
  return `dm-icon-${status}-${sequenceLabelOf(sequence) || 'none'}`
}

// 高分屏（Retina 等）下按 devicePixelRatio 栅格化图标，避免被放大导致模糊；上限 3 防止个别设备离谱的比例生成过大位图
const ICON_PIXEL_RATIO = Math.min(3, Math.max(1, window.devicePixelRatio || 1))

async function ensureIconsRegistered(
  map: maplibregl.Map,
  registered: Set<string>,
  needed: Map<string, { status: DriverMapPointStatus; sequence?: number }>,
): Promise<void> {
  const toLoad = [...needed.entries()].filter(([id]) => !registered.has(id) && !map.hasImage(id))
  if (toLoad.length === 0) return
  await Promise.all(
    toLoad.map(
      ([id, { status, sequence }]) =>
        new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: ICON_PIXEL_RATIO })
            registered.add(id)
            resolve()
          }
          img.onerror = () => {
            console.warn(`[driver-map] 图标加载失败: ${id}`)
            resolve()
          }
          img.src = buildStatusPinIconUrl(status, sequence, ICON_PIXEL_RATIO)
        }),
    ),
  )
}

export function DriverMapView({ drivers }: { drivers: DriverMapDriver[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const layersReadyRef = useRef(false)
  const registeredIconIdsRef = useRef<Set<string>>(new Set())
  const applyOverlaysRef = useRef<() => void>(() => {})

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

    let cancelled = false

    // 点位/轨迹线渲染载体：GeoJSON source + symbol/line layer（WebGL），只建一次，
    // 数据更新走 source.setData()，不再每次都整体删除重建 DOM Marker
    const setupLayers = () => {
      if (cancelled || map.getSource(POINTS_SOURCE_ID)) return

      map.addSource(POINTS_SOURCE_ID, { type: 'geojson', data: EMPTY_FC })
      map.addSource(TRAILS_SOURCE_ID, { type: 'geojson', data: EMPTY_FC })

      // 先加轨迹线层再加点位层，保证点位图标视觉上盖在线的上方
      map.addLayer({
        id: TRAILS_LAYER_ID,
        type: 'line',
        source: TRAILS_SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': 0.85,
          'line-width': 3,
        },
      })
      map.addLayer({
        id: POINTS_LAYER_ID,
        type: 'symbol',
        source: POINTS_SOURCE_ID,
        layout: {
          // 数字已烤进图标图片本身（见 iconIdOf），不用独立 text-field，避免透视
          'icon-image': ['get', 'iconId'],
          'icon-size': 1,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })

      // 委托事件：只挂一次，不随点位数量增长
      map.on('mouseenter', POINTS_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', POINTS_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('click', POINTS_LAYER_ID, (e) => {
        const f = e.features?.[0]
        if (!f || f.geometry.type !== 'Point') return
        const props = f.properties as Record<string, unknown>
        const [lng, lat] = f.geometry.coordinates
        popupRef.current
          ?.setLngLat([lng, lat])
          .setHTML(
            buildPointInfoWindowHtml({
              courierName: String(props.courierName ?? ''),
              waybillNo: String(props.waybillNo ?? ''),
              status: props.status as DriverMapPointStatus,
              time: String(props.time ?? ''),
              address: String(props.address ?? ''),
              sequence: typeof props.sequence === 'number' ? props.sequence : undefined,
              problemReason: typeof props.problemReason === 'string' ? props.problemReason : undefined,
            }),
          )
          .addTo(map)
      })

      layersReadyRef.current = true
      applyOverlaysRef.current()
    }

    if (map.isStyleLoaded()) setupLayers()
    else map.once('load', setupLayers)

    map.on('click', (e) => {
      const hits = map.getLayer(POINTS_LAYER_ID)
        ? map.queryRenderedFeatures(e.point, { layers: [POINTS_LAYER_ID] })
        : []
      if (hits.length > 0) return // 命中点位，交给上面 layer-scoped click 处理器开弹窗
      popupRef.current?.remove()
    })

    return () => {
      cancelled = true
      layersReadyRef.current = false
      registeredIconIdsRef.current = new Set()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false

    const apply = async () => {
      const pointFeatures: Feature[] = []
      const trailFeatures: Feature[] = []
      const bounds = new maplibregl.LngLatBounds()
      const neededIcons = new Map<string, { status: DriverMapPointStatus; sequence?: number }>()
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
          trailFeatures.push({
            type: 'Feature',
            properties: { color: trailColorForDriver(driver.courierCode) },
            geometry: { type: 'LineString', coordinates: trailPoints.map((p) => [p.lng, p.lat]) },
          })
        }

        for (const point of driver.points) {
          const sequence = point.status === 'pending' ? undefined : sequenceByWaybill.get(point.waybillNo)
          const iconId = iconIdOf(point.status, sequence)
          if (!neededIcons.has(iconId)) neededIcons.set(iconId, { status: point.status, sequence })
          pointFeatures.push({
            type: 'Feature',
            properties: {
              iconId,
              courierName: driver.courierName,
              waybillNo: point.waybillNo,
              status: point.status,
              time: point.time,
              address: point.address,
              problemReason: point.problemReason ?? null,
              sequence: sequence ?? null,
            },
            geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
          })
          bounds.extend([point.lng, point.lat])
          hasPoint = true
        }
      }

      await ensureIconsRegistered(map, registeredIconIdsRef.current, neededIcons)
      if (cancelled) return

      const pointsSource = map.getSource(POINTS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      const trailsSource = map.getSource(TRAILS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      pointsSource?.setData({ type: 'FeatureCollection', features: pointFeatures })
      trailsSource?.setData({ type: 'FeatureCollection', features: trailFeatures })

      if (hasPoint) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 15 })
      }
    }

    applyOverlaysRef.current = () => {
      void apply()
    }
    if (layersReadyRef.current) void apply()

    return () => {
      cancelled = true
    }
  }, [drivers])

  return <div ref={containerRef} style={{ width: '100%', height: 480, borderRadius: 12 }} />
}
