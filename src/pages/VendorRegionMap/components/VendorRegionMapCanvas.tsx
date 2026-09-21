import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Columns3, Compass, Radar, Warehouse } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../../i18n'
import { VendorRegionMapLoading } from './VendorRegionMapLoading'
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { colorFromMap } from '../vendorColors'
import {
  aggregateZipStats,
  buildColumnCollection,
  buildRegionFillCollection,
  buildRouteCodeLabelCollection,
  columnHeightRatio,
  columnMaxHeightM,
  columnRadiusM,
  columnWorldScale,
  heightLegendTicks,
  maxZipTotal,
  REGION_FILL_OPACITY_MAX,
  REGION_FILL_OPACITY_MIN,
  type RouteCodeLabelGroup,
  type ZipStat,
} from '../columnGeometry'
import { formatAreaKm2, formatDensity } from '../regionMetrics'
import {
  ADELAIDE_MAP_CENTER,
  ADELAIDE_MAP_ZOOM,
  formatMetricValue,
  isMoneyMetric,
  WAREHOUSE,
  warehouseRingScaleLabel,
  type MapMetric,
  type VendorRegionMapResult,
} from '../vendorRegionMapTypes'
import {
  buildWarehousePadCollection,
  buildWarehousePopupHtml,
  buildWarehouseRingCollection,
  createRingChipImage,
  createWarehouseMarkerElement,
  formatDistanceKm,
  haversineKm,
  RING_CHIP_IMAGE_ID,
} from '../warehouseOverlay'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const REGIONS_SOURCE = 'vrm-regions'
const COLUMNS_SOURCE = 'vrm-columns'
const REGIONS_FILL = 'vrm-regions-fill'
const REGIONS_LINE = 'vrm-regions-line'
const COLUMNS_EXTRUSION = 'vrm-columns-extrusion'
const ROUTE_CODES_SOURCE = 'vrm-routecodes'
const ROUTE_CODES_LABEL = 'vrm-routecodes-label'
const WAREHOUSE_PAD_SOURCE = 'vrm-wh-pad'
const WAREHOUSE_RINGS_SOURCE = 'vrm-wh-rings'
const WAREHOUSE_PAD_LAYER = 'vrm-wh-pad-fill'
const WAREHOUSE_RINGS_LAYER = 'vrm-wh-rings-line'
const WAREHOUSE_RINGS_LABEL = 'vrm-wh-rings-label'
const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] }

/**
 * 圈和数字非对称处理：线只是背景参照，压到极淡；数字要一眼看见，全程满强度。
 * 两者都在放大看郊区时退场（那时弹窗已经写了距仓库多远），数字略早于线走，
 * 免得线没了还飘着孤零零的药丸。
 */
const RING_LINE_OPACITY: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  9, 0.3,
  11.5, 0.26,
  12.4, 0.16,
  13.2, 0,
]
const RING_LABEL_OPACITY: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  9, 1,
  12.2, 1,
  13, 0,
]

/** 路由码标签跟距离圈标签相反：缩小时不挤堆——直接不渲染；放大到邮区级别才淡入显示 */
const ROUTE_LABEL_MIN_ZOOM = 7
const ROUTE_LABEL_OPACITY: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  ROUTE_LABEL_MIN_ZOOM, 0,
  8.5, 1,
]
// interpolate 在两端会夹住不再变化：zoom<7 用 7 档那个值、zoom>14 用 14 档那个值，
// 所以 14 档天然就是放大时的字号上限，不用另外设置
const ROUTE_LABEL_TEXT_SIZE: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  7, 8,
  14, 17,
]

/** worldScale 按 5 m/px 取整再入 state，避免每次微小缩放都重建几何 */
const WORLD_SCALE_STEP = 5
const LEGEND_BAR_MIN_PX = 4
const LEGEND_BAR_MAX_PX = 42

type Props = {
  data: VendorRegionMapResult | null
  loading: boolean
  selectedSupplierKeys: string[]
  colorMap: Map<string, string>
  metric: MapMetric
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function quantizeWorldScale(map: maplibregl.Map): number {
  const scale = columnWorldScale(map.getCenter().lat, map.getZoom())
  return Math.round(scale / WORLD_SCALE_STEP) * WORLD_SCALE_STEP
}

const DEFAULT_PITCH = 58
const DEFAULT_BEARING = -22
const TOP_DOWN_PITCH = 0
const TOP_DOWN_BEARING = 0

function resetCamera(map: maplibregl.Map) {
  map.easeTo({
    center: [ADELAIDE_MAP_CENTER.lng, ADELAIDE_MAP_CENTER.lat],
    zoom: ADELAIDE_MAP_ZOOM,
    pitch: DEFAULT_PITCH,
    bearing: DEFAULT_BEARING,
    duration: 700,
  })
}

function flyToWarehouse(map: maplibregl.Map) {
  map.easeTo({
    center: [WAREHOUSE.lng, WAREHOUSE.lat],
    zoom: 12.2,
    pitch: DEFAULT_PITCH,
    bearing: DEFAULT_BEARING,
    duration: 700,
  })
}

/** 只转视角，不挪中心点/缩放——切俯瞰看整体分布或切回 3D 看柱高，不打断当前浏览的位置 */
function setViewPitch(map: maplibregl.Map, topDown: boolean) {
  map.easeTo({
    pitch: topDown ? TOP_DOWN_PITCH : DEFAULT_PITCH,
    bearing: topDown ? TOP_DOWN_BEARING : DEFAULT_BEARING,
    duration: 700,
  })
}

function buildPopupHtml(
  stat: ZipStat,
  colorMap: Map<string, string>,
  distanceLabel: string,
  metric: MapMetric,
) {
  const t = (key: string, opts?: Record<string, unknown>) =>
    String(i18n.t(key, { ns: 'vendorRegionMap', ...opts }))
  const top = stat.rows[0]?.value ?? 0
  const items = stat.rows
    .map(({ cell, value }) => {
      const color = colorFromMap(colorMap, cell.supplierKey)
      const share = top > 0 ? Math.max(4, (value / top) * 100) : 0
      return `
        <li class="vrm-iw__row">
          <span class="vrm-iw__swatch" style="background:${color}"></span>
          <span class="vrm-iw__name">${escapeHtml(cell.supplierName)}</span>
          <span class="vrm-iw__count">${formatMetricValue(value, metric)}</span>
          <span class="vrm-iw__meter"><span style="width:${share}%;background:${color}"></span></span>
        </li>`
    })
    .join('')
  const place = stat.suburb
    ? `${escapeHtml(stat.zipCode)} · ${escapeHtml(stat.suburb)}`
    : escapeHtml(stat.zipCode)
  const facts: string[] = []
  if (distanceLabel) facts.push(t('popupDistance', { distance: escapeHtml(distanceLabel) }))
  if (stat.areaKm2 != null) facts.push(t('popupArea', { area: formatAreaKm2(stat.areaKm2) }))
  facts.push(
    stat.density != null
      ? t(isMoneyMetric(metric) ? 'popupDensityMoney' : 'popupDensity', {
          density: formatDensity(stat.density),
        })
      : t('popupDensityMissing'),
  )
  // 金额是几票算出来的、有多少票没价可算，都得摆在弹窗里，否则读者无从判断这个数可不可信
  if (isMoneyMetric(metric)) {
    facts.push(t('popupParcels', { count: stat.packageCount.toLocaleString('en-AU') }))
    if (stat.unpricedCount > 0) {
      facts.push(t('popupUnpriced', { count: stat.unpricedCount.toLocaleString('en-AU') }))
    }
  }
  return `
    <div class="vrm-iw">
      <div class="vrm-iw__head">
        <div class="vrm-iw__zip">${place}</div>
        <div class="vrm-iw__total">${formatMetricValue(stat.total, metric)}</div>
      </div>
      <div class="vrm-iw__dist">${facts.join(' · ')}</div>
      <ul class="vrm-iw__list">${items}</ul>
    </div>`
}

export function VendorRegionMapCanvas({
  data,
  loading,
  selectedSupplierKeys,
  colorMap,
  metric,
}: Props) {
  const { t } = useTranslation('vendorRegionMap')
  const shellRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const layersReadyRef = useRef(false)
  const applyRef = useRef<() => void>(() => {})
  const fittedQueryRef = useRef<string>('')
  const statsRef = useRef<Map<string, ZipStat>>(new Map())
  const colorMapRef = useRef(colorMap)
  const metricRef = useRef(metric)
  const warehouseMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [ringsVisible, setRingsVisible] = useState(true)
  const [columnsVisible, setColumnsVisible] = useState(true)
  const [topDown, setTopDown] = useState(false)
  const [legendExpanded, setLegendExpanded] = useState(false)
  const [worldScale, setWorldScale] = useState(() =>
    Math.round(columnWorldScale(ADELAIDE_MAP_CENTER.lat, ADELAIDE_MAP_ZOOM) / WORLD_SCALE_STEP) *
    WORLD_SCALE_STEP,
  )

  useEffect(() => {
    colorMapRef.current = colorMap
  }, [colorMap])

  useEffect(() => {
    metricRef.current = metric
  }, [metric])

  const visibleCells = useMemo(() => {
    if (!data) return []
    if (selectedSupplierKeys.length === 0) return []
    const selected = new Set(selectedSupplierKeys)
    if (selected.size === data.vendors.length) return data.cells
    return data.cells.filter((cell) => selected.has(cell.supplierKey))
  }, [data, selectedSupplierKeys])

  // 填色层与柱体层共用这一份聚合，勾选供应商时两层始终自洽
  const zipStats = useMemo(
    () => aggregateZipStats({ cells: visibleCells, zipRegions: data?.zipRegions ?? [], metric }),
    [data?.zipRegions, metric, visibleCells],
  )

  // 路由码标签只跟着供应商勾选走，不受指标切换影响——它标的是线路，不是金额/票量口径
  const visibleRoutes = useMemo(() => {
    if (!data) return []
    if (selectedSupplierKeys.length === 0) return []
    const selected = new Set(selectedSupplierKeys)
    if (selected.size === data.vendors.length) return data.routes
    return data.routes.filter((route) => selected.has(route.supplierKey))
  }, [data, selectedSupplierKeys])

  const routesByZip = useMemo(() => {
    const merged = new Map<string, Map<string, number>>()
    for (const route of visibleRoutes) {
      const byRoute = merged.get(route.zipCode) ?? new Map<string, number>()
      byRoute.set(route.routeCode, (byRoute.get(route.routeCode) ?? 0) + route.count)
      merged.set(route.zipCode, byRoute)
    }
    const result = new Map<string, RouteCodeLabelGroup[]>()
    for (const [zipCode, byRoute] of merged) {
      result.set(
        zipCode,
        [...byRoute.entries()]
          .map(([routeCode, count]) => ({ routeCode, count }))
          .sort((a, b) => b.count - a.count || a.routeCode.localeCompare(b.routeCode)),
      )
    }
    return result
  }, [visibleRoutes])

  useEffect(() => {
    statsRef.current = new Map(zipStats.map((stat) => [stat.zipCode, stat]))
  }, [zipStats])

  const regionCollection = useMemo(
    () => buildRegionFillCollection(zipStats, (supplierKey) => colorFromMap(colorMap, supplierKey)),
    [colorMap, zipStats],
  )

  const columnCollection = useMemo(
    () =>
      buildColumnCollection(zipStats, {
        radiusM: columnRadiusM(worldScale),
        maxHeightM: columnMaxHeightM(worldScale),
        colorOf: (supplierKey) => colorFromMap(colorMap, supplierKey),
      }),
    [colorMap, worldScale, zipStats],
  )

  const routeLabelCollection = useMemo(
    () => buildRouteCodeLabelCollection(zipStats, routesByZip),
    [routesByZip, zipStats],
  )

  const maxTotal = useMemo(() => maxZipTotal(zipStats), [zipStats])
  const heightTicks = useMemo(() => heightLegendTicks(maxTotal), [maxTotal])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [ADELAIDE_MAP_CENTER.lng, ADELAIDE_MAP_CENTER.lat],
      zoom: ADELAIDE_MAP_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      maxPitch: 80,
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    // container 指向外层 shell，全屏时把工具条/图例一起带进去，不然只有裸地图放大、按钮全没了
    map.addControl(new maplibregl.FullscreenControl({ container: shellRef.current ?? undefined }), 'top-right')
    mapRef.current = map
    popupRef.current = new maplibregl.Popup({ closeButton: false, maxWidth: '280px', offset: 16 })

    const openWarehousePopup = () => {
      popupRef.current
        ?.setLngLat([WAREHOUSE.lng, WAREHOUSE.lat])
        .setHTML(buildWarehousePopupHtml())
        .addTo(map)
    }

    const markerEl = createWarehouseMarkerElement()
    markerEl.addEventListener('click', (event) => {
      event.stopPropagation()
      openWarehousePopup()
    })
    const warehouseMarker = new maplibregl.Marker({ element: markerEl, anchor: 'bottom' })
      .setLngLat([WAREHOUSE.lng, WAREHOUSE.lat])
      .addTo(map)
    warehouseMarkerRef.current = warehouseMarker

    const handleZoomEnd = () => {
      const next = quantizeWorldScale(map)
      setWorldScale((current) => (current === next ? current : next))
    }
    map.on('zoomend', handleZoomEnd)

    const setupLayers = () => {
      if (!map.getSource(REGIONS_SOURCE)) {
        map.addSource(REGIONS_SOURCE, { type: 'geojson', data: EMPTY_FC })
        map.addSource(COLUMNS_SOURCE, { type: 'geojson', data: EMPTY_FC })
        map.addSource(ROUTE_CODES_SOURCE, { type: 'geojson', data: EMPTY_FC })
        map.addSource(WAREHOUSE_RINGS_SOURCE, { type: 'geojson', data: buildWarehouseRingCollection() })
        map.addSource(WAREHOUSE_PAD_SOURCE, { type: 'geojson', data: buildWarehousePadCollection() })
        map.addLayer({
          id: REGIONS_FILL,
          type: 'fill',
          source: REGIONS_SOURCE,
          paint: {
            'fill-color': ['get', 'fillColor'],
            'fill-opacity': ['to-number', ['get', 'fillOpacity']],
          },
        })
        map.addLayer({
          id: REGIONS_LINE,
          type: 'line',
          source: REGIONS_SOURCE,
          paint: {
            'line-color': '#0f172a',
            'line-width': 0.9,
            'line-opacity': 0.32,
          },
        })
        map.addLayer({
          id: WAREHOUSE_RINGS_LAYER,
          type: 'line',
          source: WAREHOUSE_RINGS_SOURCE,
          paint: {
            'line-color': '#1f6f68',
            'line-width': 1,
            'line-opacity': RING_LINE_OPACITY,
            'line-dasharray': [3, 3.2],
          },
        })
        // 标签沿弧线摆放：MapLibre 自动避让、挤不下就隐藏，不会再像 DOM marker 那样全钉在正北堆成一列
        const chip = createRingChipImage()
        if (chip && !map.hasImage(RING_CHIP_IMAGE_ID)) {
          map.addImage(RING_CHIP_IMAGE_ID, chip.data, chip.options)
        }
        map.addLayer({
          id: WAREHOUSE_RINGS_LABEL,
          type: 'symbol',
          source: WAREHOUSE_RINGS_SOURCE,
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 700,
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 12.5,
            'text-letter-spacing': 0.02,
            'text-padding': 10,
            // 地图俯视 58°，不锁 viewport 的话药丸和字会跟着地面一起被压扁、斜着躺在弧线上
            'text-rotation-alignment': 'viewport',
            'text-pitch-alignment': 'viewport',
            'icon-rotation-alignment': 'viewport',
            'icon-pitch-alignment': 'viewport',
            ...(chip
              ? {
                  'icon-image': RING_CHIP_IMAGE_ID,
                  'icon-text-fit': 'both' as const,
                  'icon-text-fit-padding': [1, 7, 1, 7] as [number, number, number, number],
                }
              : {}),
          },
          paint: {
            'text-color': '#14514c',
            // 药丸画不出来时（浏览器不支持 roundRect）退回描边文字，仍然读得清
            'text-halo-color': chip ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,0.95)',
            'text-halo-width': chip ? 0 : 1.8,
            'text-opacity': RING_LABEL_OPACITY,
            'icon-opacity': RING_LABEL_OPACITY,
          },
        })
        map.addLayer({
          id: WAREHOUSE_PAD_LAYER,
          type: 'fill',
          source: WAREHOUSE_PAD_SOURCE,
          paint: {
            'fill-color': '#1f6f68',
            'fill-opacity': 0.38,
          },
        })
        map.addLayer({
          id: COLUMNS_EXTRUSION,
          type: 'fill-extrusion',
          source: COLUMNS_SOURCE,
          paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-height': ['to-number', ['get', 'height']],
            'fill-extrusion-base': ['to-number', ['get', 'base']],
            'fill-extrusion-opacity': 0.94,
            'fill-extrusion-vertical-gradient': true,
          },
        })
        // 要求尽可能多地露出路由码，哪怕缩小也一样，所以关掉碰撞避让（text-allow-overlap:true）——
        // 都画出来，宁可叠字也不隐藏。symbol-sort-key 决定叠在一起时谁画在最上面（票量大的在上）
        map.addLayer({
          id: ROUTE_CODES_LABEL,
          type: 'symbol',
          source: ROUTE_CODES_SOURCE,
          minzoom: ROUTE_LABEL_MIN_ZOOM,
          layout: {
            'text-field': ['get', 'routeCode'],
            'text-font': ['Noto Sans Bold'],
            'text-size': ROUTE_LABEL_TEXT_SIZE,
            'text-padding': 2,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'symbol-sort-key': ['get', 'sortKey'],
          },
          paint: {
            // 跟底图地名的深灰/黑拉开，一眼能分出这是业务标签而不是底图自带的文字
            'text-color': '#0000ff',
            'text-halo-color': 'rgba(255,255,255,0.92)',
            'text-halo-width': 1.3,
            'text-opacity': ROUTE_LABEL_OPACITY,
          },
        })
      }

      const openPopup = (zipCode: string, lngLat: maplibregl.LngLatLike) => {
        const stat = statsRef.current.get(zipCode)
        if (!stat || stat.rows.length === 0) return
        const distanceLabel = stat.center
          ? formatDistanceKm(haversineKm(WAREHOUSE.lat, WAREHOUSE.lng, stat.center[1], stat.center[0]))
          : ''
        popupRef.current
          ?.setLngLat(lngLat)
          .setHTML(buildPopupHtml(stat, colorMapRef.current, distanceLabel, metricRef.current))
          .addTo(map)
      }

      // 顺序有讲究：柱体的监听后注册、后触发，点柱子时它的邮区覆盖掉底下的面。
      // 路由码标签也点得开同一个邮区弹窗——点一下就能确认这个标签到底对应哪个邮编
      for (const layerId of [REGIONS_FILL, COLUMNS_EXTRUSION, ROUTE_CODES_LABEL]) {
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = ''
        })
        map.on('click', layerId, (event) => {
          const zipCode = String(event.features?.[0]?.properties?.zipCode ?? '')
          if (zipCode) openPopup(zipCode, event.lngLat)
        })
      }
      map.on('mouseenter', WAREHOUSE_PAD_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', WAREHOUSE_PAD_LAYER, () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('click', WAREHOUSE_PAD_LAYER, () => {
        openWarehousePopup()
      })

      layersReadyRef.current = true
      applyRef.current()
    }

    if (map.isStyleLoaded()) setupLayers()
    else map.once('load', setupLayers)

    return () => {
      layersReadyRef.current = false
      map.off('zoomend', handleZoomEnd)
      warehouseMarkerRef.current?.remove()
      warehouseMarkerRef.current = null
      popupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.getLayer(WAREHOUSE_RINGS_LAYER)) return
    const visibility = ringsVisible ? 'visible' : 'none'
    map.setLayoutProperty(WAREHOUSE_RINGS_LAYER, 'visibility', visibility)
    map.setLayoutProperty(WAREHOUSE_RINGS_LABEL, 'visibility', visibility)
  }, [ringsVisible])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.getLayer(COLUMNS_EXTRUSION)) return
    map.setLayoutProperty(COLUMNS_EXTRUSION, 'visibility', columnsVisible ? 'visible' : 'none')
  }, [columnsVisible])

  useEffect(() => {
    const map = mapRef.current
    const apply = () => {
      ;(map?.getSource(REGIONS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(regionCollection)
      ;(map?.getSource(COLUMNS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(columnCollection)
      ;(map?.getSource(ROUTE_CODES_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(routeLabelCollection)

      const queryKey = data ? `${data.meta.startDate}:${data.meta.endDate}:${data.cells.length}` : ''
      if (!data || !map || fittedQueryRef.current === queryKey) return

      const bounds = new maplibregl.LngLatBounds()
      bounds.extend([WAREHOUSE.lng, WAREHOUSE.lat])
      for (const cell of data.cells) {
        if (cell.lng == null || cell.lat == null) continue
        bounds.extend([cell.lng, cell.lat])
      }
      map.fitBounds(bounds, {
        padding: 72,
        maxZoom: 11.6,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        duration: 800,
      })
      fittedQueryRef.current = queryKey
    }

    applyRef.current = apply
    if (layersReadyRef.current) apply()
  }, [columnCollection, data, regionCollection, routeLabelCollection])

  const hasData = Boolean(data && data.cells.length > 0)
  const allHidden = hasData && visibleCells.length === 0

  return (
    <div ref={shellRef} className="vrm-map-shell">
      <div ref={containerRef} className="vrm-map-canvas" />

      <div className="vrm-map-tools vrm-glass">
        <button
          type="button"
          className="vrm-tool"
          aria-pressed={topDown}
          onClick={() => {
            const map = mapRef.current
            if (!map) return
            const next = !topDown
            // 切俯瞰只转角度、不挪位置；切回 3D 顺带把位置也复位，这样按钮还兼着“复位3D视角”的老功能
            if (next) setViewPitch(map, true)
            else resetCamera(map)
            setTopDown(next)
          }}
        >
          <Compass className="h-4 w-4" aria-hidden />
          {t(topDown ? 'reset3d' : 'topDownView')}
        </button>
        <button
          type="button"
          className="vrm-tool"
          onClick={() => {
            if (!mapRef.current) return
            flyToWarehouse(mapRef.current)
            setTopDown(false)
          }}
        >
          <Warehouse className="h-4 w-4" aria-hidden />
          {t('locateWarehouse')}
        </button>
        <button
          type="button"
          className="vrm-tool"
          aria-pressed={ringsVisible}
          onClick={() => setRingsVisible((current) => !current)}
        >
          <Radar className="h-4 w-4" aria-hidden />
          {t('distanceRings')}
        </button>
        <button
          type="button"
          className="vrm-tool"
          aria-pressed={columnsVisible}
          onClick={() => setColumnsVisible((current) => !current)}
        >
          <Columns3 className="h-4 w-4" aria-hidden />
          {t('toggleColumns')}
        </button>
      </div>

      {allHidden ? (
        <div className="vrm-map-notice vrm-glass" role="status">
          <span dangerouslySetInnerHTML={{ __html: t('noVendorsSelected') }} />
        </div>
      ) : null}

      {data && !hasData && !loading ? (
        <div className="vrm-map-notice vrm-glass" role="status">
          <span dangerouslySetInnerHTML={{ __html: t('noScanData') }} />
        </div>
      ) : null}

      <div className="vrm-map-legend vrm-glass">
        <button
          type="button"
          className="vrm-map-legend__header"
          aria-expanded={legendExpanded}
          onClick={() => setLegendExpanded((current) => !current)}
        >
          <span className="vrm-map-legend__title">{t('legendToggle')}</span>
          {legendExpanded ? (
            <ChevronUp className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden />
          )}
        </button>

        {legendExpanded ? (
          <div className="vrm-map-legend__body">
            {heightTicks.length > 0 ? (
              <div className="vrm-map-legend__block">
                <div className="vrm-map-legend__title">{t(`legendHeight_${metric}`)}</div>
                <div className="vrm-map-legend__bars">
                  {heightTicks.map((tick) => (
                    <div key={tick} className="vrm-map-legend__bar-row">
                      <span
                        className="vrm-map-legend__bar-col"
                        style={{
                          height: `${
                            LEGEND_BAR_MIN_PX +
                            columnHeightRatio(tick, maxTotal) * (LEGEND_BAR_MAX_PX - LEGEND_BAR_MIN_PX)
                          }px`,
                        }}
                        aria-hidden
                      />
                      <span className="vrm-map-legend__bar-value">{formatMetricValue(tick, metric)}</span>
                    </div>
                  ))}
                </div>
                <div className="vrm-map-legend__hint">{t('legendHeightHint')}</div>
              </div>
            ) : null}

            <div className="vrm-map-legend__block">
              <div className="vrm-map-legend__title">{t('legendVendorTitle')}</div>
              <div className="vrm-map-legend__swatches">
                <div className="vrm-map-legend__swatch-row">
                  <span
                    className="vrm-map-legend__swatch"
                    style={{ background: '#334155', opacity: REGION_FILL_OPACITY_MIN }}
                    aria-hidden
                  />
                  <span className="vrm-map-legend__swatch-label">{t('legendVendorDensityLow')}</span>
                </div>
                <div className="vrm-map-legend__swatch-row">
                  <span
                    className="vrm-map-legend__swatch"
                    style={{ background: '#334155', opacity: REGION_FILL_OPACITY_MAX }}
                    aria-hidden
                  />
                  <span className="vrm-map-legend__swatch-label">{t('legendVendorDensityHigh')}</span>
                </div>
              </div>
              <div className="vrm-map-legend__hint">{t('legendVendorHint')}</div>
            </div>

            <div className="vrm-map-legend__block">
              <div className="vrm-map-legend__wh">
                <span className="vrm-wh-marker__pin vrm-wh-marker__pin--legend" aria-hidden>
                  <Warehouse className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="vrm-map-legend__title">{t('legendWarehouse')}</div>
                  <div className="vrm-map-legend__addr">{WAREHOUSE.address}</div>
                </div>
              </div>
              <div className="vrm-map-legend__rings">
                {t('legendRings', { scale: warehouseRingScaleLabel() })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {loading ? <VendorRegionMapLoading /> : null}
    </div>
  )
}
