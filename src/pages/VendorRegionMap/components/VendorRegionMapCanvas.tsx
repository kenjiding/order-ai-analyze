import { useEffect, useMemo, useRef, useState } from 'react'
import { Compass, Radar, Warehouse } from 'lucide-react'
import { VendorRegionMapLoading } from './VendorRegionMapLoading'
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { colorFromMap } from '../vendorColors'
import {
  aggregateZipStats,
  buildColumnCollection,
  buildRegionFillCollection,
  columnHeightRatio,
  columnMaxHeightM,
  columnRadiusM,
  columnWorldScale,
  heightLegendTicks,
  maxZipTotal,
  type ZipStat,
} from '../columnGeometry'
import { buildDensityScale, formatAreaKm2, formatDensity } from '../regionMetrics'
import {
  ADELAIDE_MAP_CENTER,
  ADELAIDE_MAP_ZOOM,
  WAREHOUSE,
  warehouseRingScaleLabel,
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

/** worldScale 按 5 m/px 取整再入 state，避免每次微小缩放都重建几何 */
const WORLD_SCALE_STEP = 5
const LEGEND_BAR_MIN_PX = 4
const LEGEND_BAR_MAX_PX = 42

const nf = new Intl.NumberFormat('en-AU')

type Props = {
  data: VendorRegionMapResult | null
  loading: boolean
  selectedSupplierKeys: string[]
  colorMap: Map<string, string>
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

function resetCamera(map: maplibregl.Map) {
  map.easeTo({
    center: [ADELAIDE_MAP_CENTER.lng, ADELAIDE_MAP_CENTER.lat],
    zoom: ADELAIDE_MAP_ZOOM,
    pitch: 58,
    bearing: -22,
    duration: 700,
  })
}

function flyToWarehouse(map: maplibregl.Map) {
  map.easeTo({
    center: [WAREHOUSE.lng, WAREHOUSE.lat],
    zoom: 12.2,
    pitch: 58,
    bearing: -22,
    duration: 700,
  })
}

function buildPopupHtml(stat: ZipStat, colorMap: Map<string, string>, distanceLabel: string) {
  const top = stat.rows[0]?.count ?? 0
  const items = stat.rows
    .map((row) => {
      const color = colorFromMap(colorMap, row.supplierKey)
      const share = top > 0 ? Math.max(4, (row.count / top) * 100) : 0
      return `
        <li class="vrm-iw__row">
          <span class="vrm-iw__swatch" style="background:${color}"></span>
          <span class="vrm-iw__name">${escapeHtml(row.supplierName)}</span>
          <span class="vrm-iw__count">${row.count.toLocaleString('en-AU')}</span>
          <span class="vrm-iw__meter"><span style="width:${share}%;background:${color}"></span></span>
        </li>`
    })
    .join('')
  const place = stat.suburb
    ? `${escapeHtml(stat.zipCode)} · ${escapeHtml(stat.suburb)}`
    : escapeHtml(stat.zipCode)
  const facts: string[] = []
  if (distanceLabel) facts.push(`距仓库 ${escapeHtml(distanceLabel)}`)
  if (stat.areaKm2 != null) facts.push(`面积 ${formatAreaKm2(stat.areaKm2)} km²`)
  facts.push(
    stat.density != null ? `密度 ${formatDensity(stat.density)} 票/km²` : '密度 — <em>缺邮区边界</em>',
  )
  return `
    <div class="vrm-iw">
      <div class="vrm-iw__head">
        <div class="vrm-iw__zip">${place}</div>
        <div class="vrm-iw__total">${stat.total.toLocaleString('en-AU')} 票</div>
      </div>
      <div class="vrm-iw__dist">${facts.join(' · ')}</div>
      <ul class="vrm-iw__list">${items}</ul>
    </div>`
}

export function VendorRegionMapCanvas({ data, loading, selectedSupplierKeys, colorMap }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const layersReadyRef = useRef(false)
  const applyRef = useRef<() => void>(() => {})
  const fittedQueryRef = useRef<string>('')
  const statsRef = useRef<Map<string, ZipStat>>(new Map())
  const colorMapRef = useRef(colorMap)
  const warehouseMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [ringsVisible, setRingsVisible] = useState(true)
  const [worldScale, setWorldScale] = useState(() =>
    Math.round(columnWorldScale(ADELAIDE_MAP_CENTER.lat, ADELAIDE_MAP_ZOOM) / WORLD_SCALE_STEP) *
    WORLD_SCALE_STEP,
  )

  useEffect(() => {
    colorMapRef.current = colorMap
  }, [colorMap])

  const visibleCells = useMemo(() => {
    if (!data) return []
    if (selectedSupplierKeys.length === 0) return []
    const selected = new Set(selectedSupplierKeys)
    if (selected.size === data.vendors.length) return data.cells
    return data.cells.filter((cell) => selected.has(cell.supplierKey))
  }, [data, selectedSupplierKeys])

  // 填色层与柱体层共用这一份聚合，勾选供应商时两层始终自洽
  const zipStats = useMemo(
    () => aggregateZipStats({ cells: visibleCells, zipRegions: data?.zipRegions ?? [] }),
    [data?.zipRegions, visibleCells],
  )

  useEffect(() => {
    statsRef.current = new Map(zipStats.map((stat) => [stat.zipCode, stat]))
  }, [zipStats])

  const densityScale = useMemo(
    () =>
      buildDensityScale(
        zipStats.flatMap((stat) => (stat.density != null ? [stat.density] : [])),
      ),
    [zipStats],
  )

  const regionCollection = useMemo(
    () => buildRegionFillCollection(zipStats, densityScale),
    [densityScale, zipStats],
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

  const maxTotal = useMemo(() => maxZipTotal(zipStats), [zipStats])
  const heightTicks = useMemo(() => heightLegendTicks(maxTotal), [maxTotal])
  const densityLabels = useMemo(() => densityScale.labels(), [densityScale])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [ADELAIDE_MAP_CENTER.lng, ADELAIDE_MAP_CENTER.lat],
      zoom: ADELAIDE_MAP_ZOOM,
      pitch: 58,
      bearing: -22,
      maxPitch: 80,
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
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
        map.addSource(WAREHOUSE_RINGS_SOURCE, { type: 'geojson', data: buildWarehouseRingCollection() })
        map.addSource(WAREHOUSE_PAD_SOURCE, { type: 'geojson', data: buildWarehousePadCollection() })
        map.addLayer({
          id: REGIONS_FILL,
          type: 'fill',
          source: REGIONS_SOURCE,
          paint: {
            'fill-color': ['get', 'densityColor'],
            'fill-opacity': 0.45,
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
      }

      const openPopup = (zipCode: string, lngLat: maplibregl.LngLatLike) => {
        const stat = statsRef.current.get(zipCode)
        if (!stat || stat.rows.length === 0) return
        const distanceLabel = stat.center
          ? formatDistanceKm(haversineKm(WAREHOUSE.lat, WAREHOUSE.lng, stat.center[1], stat.center[0]))
          : ''
        popupRef.current
          ?.setLngLat(lngLat)
          .setHTML(buildPopupHtml(stat, colorMapRef.current, distanceLabel))
          .addTo(map)
      }

      // 顺序有讲究：柱体的监听后注册、后触发，点柱子时它的邮区覆盖掉底下的面
      for (const layerId of [REGIONS_FILL, COLUMNS_EXTRUSION]) {
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
    const apply = () => {
      ;(map?.getSource(REGIONS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(regionCollection)
      ;(map?.getSource(COLUMNS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(columnCollection)

      const queryKey = data ? `${data.meta.startDate}:${data.meta.endDate}:${data.cells.length}` : ''
      if (!data || !map || fittedQueryRef.current === queryKey) return

      const bounds = new maplibregl.LngLatBounds()
      bounds.extend([WAREHOUSE.lng, WAREHOUSE.lat])
      for (const cell of data.cells) {
        if (cell.lng == null || cell.lat == null) continue
        bounds.extend([cell.lng, cell.lat])
      }
      map.fitBounds(bounds, { padding: 72, maxZoom: 11.6, pitch: 58, bearing: -22, duration: 800 })
      fittedQueryRef.current = queryKey
    }

    applyRef.current = apply
    if (layersReadyRef.current) apply()
  }, [columnCollection, data, regionCollection])

  const hasData = Boolean(data && data.cells.length > 0)
  const allHidden = hasData && visibleCells.length === 0

  return (
    <div className="vrm-map-shell">
      <div ref={containerRef} className="vrm-map-canvas" />

      <div className="vrm-map-tools vrm-glass">
        <button
          type="button"
          className="vrm-tool"
          onClick={() => mapRef.current && resetCamera(mapRef.current)}
        >
          <Compass className="h-4 w-4" aria-hidden />
          复位 3D 视角
        </button>
        <button
          type="button"
          className="vrm-tool"
          onClick={() => mapRef.current && flyToWarehouse(mapRef.current)}
        >
          <Warehouse className="h-4 w-4" aria-hidden />
          定位仓库
        </button>
        <button
          type="button"
          className="vrm-tool"
          aria-pressed={ringsVisible}
          onClick={() => setRingsVisible((current) => !current)}
        >
          <Radar className="h-4 w-4" aria-hidden />
          距离圈
        </button>
      </div>

      {allHidden ? (
        <div className="vrm-map-notice vrm-glass" role="status">
          供应商已全部取消勾选，<strong>地图上暂不显示柱体</strong>
        </div>
      ) : null}

      {data && !hasData && !loading ? (
        <div className="vrm-map-notice vrm-glass" role="status">
          当前日期区间<strong>没有可上图的到件扫描</strong>，换个日期再查询
        </div>
      ) : null}

      <div className="vrm-map-legend vrm-glass">
        {heightTicks.length > 0 ? (
          <div className="vrm-map-legend__block">
            <div className="vrm-map-legend__title">柱高 = 该邮区票量</div>
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
                  <span className="vrm-map-legend__bar-value">{nf.format(tick)}</span>
                </div>
              ))}
            </div>
            <div className="vrm-map-legend__hint">平方根标度；等底柱，跨邮区可直接比高矮</div>
          </div>
        ) : null}

        {densityLabels.length > 0 ? (
          <div className="vrm-map-legend__block">
            <div className="vrm-map-legend__title">底图深浅 = 配送密度</div>
            <div className="vrm-map-legend__swatches">
              {densityScale.colors.map((color, index) => (
                <div key={color} className="vrm-map-legend__swatch-row">
                  <span className="vrm-map-legend__swatch" style={{ background: color }} aria-hidden />
                  <span className="vrm-map-legend__swatch-label">{densityLabels[index]}</span>
                </div>
              ))}
            </div>
            <div className="vrm-map-legend__hint">单位 票/km²，按当次查询结果分位分级</div>
          </div>
        ) : null}

        <div className="vrm-map-legend__block">
          <div className="vrm-map-legend__wh">
            <span className="vrm-wh-marker__pin vrm-wh-marker__pin--legend" aria-hidden>
              <Warehouse className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="vrm-map-legend__title">本仓库</div>
              <div className="vrm-map-legend__addr">{WAREHOUSE.address}</div>
            </div>
          </div>
          <div className="vrm-map-legend__rings">
            虚线同心圆：距仓库 {warehouseRingScaleLabel()}
          </div>
        </div>
      </div>

      {loading ? <VendorRegionMapLoading /> : null}
    </div>
  )
}
