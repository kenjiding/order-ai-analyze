import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Columns3, Compass, Radar, Route, Warehouse } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../../i18n'
import { VendorRegionMapLoading } from './VendorRegionMapLoading'
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { colorFromMap } from '../vendorColors'
import { useAuthStore } from '../../../stores/authStore'
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
  type RouteLabelArea,
  type ZipStat,
} from '../columnGeometry'
import { formatAreaKm2, formatDensity } from '../regionMetrics'
import { useWarehouseConfigData } from '../useWarehouseConfigData'
import {
  ADELAIDE_MAP_ZOOM,
  formatMetricValue,
  isMoneyMetric,
  resolveRegionMapCenter,
  warehouseRingScaleLabel,
  type MapMetric,
  type VendorRegionMapResult,
} from '../vendorRegionMapTypes'
import {
  buildStationPopupHtml,
  buildWarehousePadCollection,
  buildWarehousePopupHtml,
  buildWarehouseRingCollection,
  createRingChipImage,
  createStationMarkerElement,
  createWarehouseMarkerElement,
  escapeHtml,
  formatDistanceKm,
  haversineKm,
  RING_CHIP_IMAGE_ID,
  type WarehousePoint,
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

/**
 * 同一路由码的候选点之间这么近就合并——用途见下面 routeLabelAreas 里的注释。
 * 1500m 太激进：贪心合并下，一个票量最大的代表点只要跟别的点在阈值内就会吸进来，哪怕那些
 * 点彼此相距很远，市区一片挨着的郊区很容易被吸成一两个点。改成 700m——用实测过的内城区
 * 郊区间距做参考，只吃掉 Renown Park/Ridleyton 这种低于 700m、基本挨在一起的组合，
 * 1200~1700m 这个市区最常见的相邻郊区间距会保留成独立标签。
 */
const ROUTE_MERGE_DISTANCE_M = 700

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

/** 填色层/柱体层现在按「邮区+郊区」分组，点击弹窗查 statsRef 也要用同一个复合 key，不能只用邮编 */
function areaStatKey(zipCode: string, suburb: string): string {
  return `${zipCode}\0${suburb}`
}

function quantizeWorldScale(map: maplibregl.Map): number {
  const scale = columnWorldScale(map.getCenter().lat, map.getZoom())
  return Math.round(scale / WORLD_SCALE_STEP) * WORLD_SCALE_STEP
}

const DEFAULT_PITCH = 58
const DEFAULT_BEARING = -22
const TOP_DOWN_PITCH = 0
const TOP_DOWN_BEARING = 0

function flyToWarehouse(map: maplibregl.Map, warehouse: WarehousePoint) {
  map.easeTo({
    center: [warehouse.lng, warehouse.lat],
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
  // 主仓/站点数据是异步拉到的，可能比地图图层建好得早或得晚——跟 applyRef 同一套「谁先到谁触发」模式，
  // 拆成独立的 ref 而不是塞进 applyRef：更新节奏完全不同（几乎只在进页面时变一次，不跟着查询筛选动）
  const applyWarehouseRef = useRef<() => void>(() => {})
  // 只在本次会话第一次拿到数据时自动 fit 一次；之后用户改日期/筛选重新查询，
  // 都不再抢镜头——不然每次查询都会把用户手动缩放/平移过的视角冲掉
  const hasFittedOnceRef = useRef(false)
  const statsRef = useRef<Map<string, ZipStat>>(new Map())
  const colorMapRef = useRef(colorMap)
  const metricRef = useRef(metric)
  const warehouseMarkerRef = useRef<maplibregl.Marker | null>(null)
  const stationMarkersRef = useRef<maplibregl.Marker[]>([])
  // 账号所属州决定地图落点；地图只在挂载时创建一次，州在会话内不会变
  const regionCode = useAuthStore((s) => s.user?.regionCode ?? null)
  const regionCenter = useMemo(() => resolveRegionMapCenter(regionCode), [regionCode])
  const [ringsVisible, setRingsVisible] = useState(true)
  const [columnsVisible, setColumnsVisible] = useState(true)
  const [routeCodesVisible, setRouteCodesVisible] = useState(true)
  const [topDown, setTopDown] = useState(false)
  const [legendExpanded, setLegendExpanded] = useState(false)
  const [worldScale, setWorldScale] = useState(() =>
    Math.round(columnWorldScale(regionCenter.lat, ADELAIDE_MAP_ZOOM) / WORLD_SCALE_STEP) *
    WORLD_SCALE_STEP,
  )

  // 大区主仓 + 站点坐标是静态参考数据，跟地图数据查询无关；地图挂载时立刻拉，不等用户点「查询」
  const { regionWarehouse, stations, loaded: warehouseLoaded } = useWarehouseConfigData()
  // regionWarehouse 引用本身是稳定的（只在 fetch 真正resolve 时变一次），这里 useMemo 一下
  // 避免每次渲染都产出新对象引用，导致下面依赖它的 effect 每次渲染都重建地图 marker
  const warehousePoint = useMemo<WarehousePoint | null>(
    () =>
      regionWarehouse
        ? { name: regionWarehouse.name, address: regionWarehouse.address, lat: regionWarehouse.lat, lng: regionWarehouse.lng }
        : null,
    [regionWarehouse],
  )
  // 地图的挂载 effect 只跑一次，但仓库数据是异步到达的——用 ref 给那些在挂载时就注册好的
  // 闭包（点击事件、popup 距离计算）一份「随时最新」的镜像，不然它们会一直读到挂载那一刻的 null
  const warehousePointRef = useRef<WarehousePoint | null>(warehousePoint)
  useEffect(() => {
    warehousePointRef.current = warehousePoint
  })

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

  // 邮区中心点当兜底：郊区质心查不到（拼写对不上 ABS 官方名、州份未知等）时用它，总比整条路由码消失强
  const zipCenterByCode = useMemo(() => {
    const map = new Map<string, [number, number]>()
    for (const stat of zipStats) if (stat.center) map.set(stat.zipCode, stat.center)
    return map
  }, [zipStats])

  const routeLabelAreas = useMemo<RouteLabelArea[]>(() => {
    type RoutePoint = {
      zipCode: string
      suburb: string
      routeCode: string
      supplierKey: string
      count: number
      anchor: [number, number] | null
    }
    const points: RoutePoint[] = visibleRoutes.map((route) => ({
      zipCode: route.zipCode,
      suburb: route.suburb,
      routeCode: route.routeCode,
      supplierKey: route.supplierKey,
      count: route.count,
      anchor: route.lat != null && route.lng != null ? [route.lng, route.lat] : zipCenterByCode.get(route.zipCode) ?? null,
    }))

    // 同一路由码常常在好几个挨得很近的小郊区都有票（内城区郊区一个挨一个，consigneeCity 分得比
    // 实际配送片区细），不合并的话地图上会钉出七八个一模一样的标签，看着乱还没多少信息量。
    // 按路由码分组、组内按票量降序贪心合并：票量最大的子区当代表点占住位置，附近的小票量子区
    // 并进它的计数，不重新算加权中心——票量最大的地方本来就最能代表这条路由主要在哪。
    // 阈值 1.5km：明显盖过市区相邻郊区间距，又明显小于真正分属两片区域的距离（不会把 4km 开外
    // 、货真价实分属两片的情况也吞并成一个点）。
    const byRouteCode = new Map<string, RoutePoint[]>()
    for (const point of points) {
      if (!point.anchor) continue
      const list = byRouteCode.get(point.routeCode) ?? []
      list.push(point)
      byRouteCode.set(point.routeCode, list)
    }
    const mergedPoints: RoutePoint[] = []
    for (const group of byRouteCode.values()) {
      const survivors: RoutePoint[] = []
      for (const point of [...group].sort((a, b) => b.count - a.count)) {
        const near = survivors.find(
          (s) =>
            haversineKm(point.anchor![1], point.anchor![0], s.anchor![1], s.anchor![0]) * 1000 <=
            ROUTE_MERGE_DISTANCE_M,
        )
        if (near) near.count += point.count
        else survivors.push({ ...point })
      }
      mergedPoints.push(...survivors)
    }

    // 合并后再按「邮区+郊区」分组摆环形——同一片区内不同路由码之间互相错位，这一步逻辑不变
    type AreaAcc = {
      zipCode: string
      suburb: string
      anchor: [number, number] | null
      routes: Map<string, { count: number; supplierKey: string }>
    }
    const areas = new Map<string, AreaAcc>()
    for (const point of mergedPoints) {
      const areaKey = `${point.zipCode}\0${point.suburb}`
      let area = areas.get(areaKey)
      if (!area) {
        area = { zipCode: point.zipCode, suburb: point.suburb, anchor: point.anchor, routes: new Map() }
        areas.set(areaKey, area)
      }
      // 极少数场景下同一路由码字符串被两家供应商共用，标签颜色跟着票量占优的那家走
      const existing = area.routes.get(point.routeCode)
      if (existing) existing.count += point.count
      else area.routes.set(point.routeCode, { count: point.count, supplierKey: point.supplierKey })
    }
    return [...areas.values()].map((area) => ({
      zipCode: area.zipCode,
      suburb: area.suburb,
      anchor: area.anchor,
      routes: [...area.routes.entries()]
        .map(([routeCode, { count, supplierKey }]) => ({ routeCode, count, supplierKey }))
        .sort((a, b) => b.count - a.count || a.routeCode.localeCompare(b.routeCode)),
    }))
  }, [visibleRoutes, zipCenterByCode])

  useEffect(() => {
    statsRef.current = new Map(zipStats.map((stat) => [areaStatKey(stat.zipCode, stat.suburb), stat]))
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
    () => buildRouteCodeLabelCollection(routeLabelAreas, (supplierKey) => colorFromMap(colorMap, supplierKey)),
    [colorMap, routeLabelAreas],
  )

  const maxTotal = useMemo(() => maxZipTotal(zipStats), [zipStats])
  const heightTicks = useMemo(() => heightLegendTicks(maxTotal), [maxTotal])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [regionCenter.lng, regionCenter.lat],
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

    // 主仓坐标是异步拉到的，挂载这一刻可能还没有——marker 本身在下面单独一个 effect 里
    // 按 warehousePoint 变化创建/挪动/移除，这里只注册一个读「最新 ref」的弹窗开启函数
    const openWarehousePopup = () => {
      const warehouse = warehousePointRef.current
      if (!warehouse) return
      popupRef.current
        ?.setLngLat([warehouse.lng, warehouse.lat])
        .setHTML(buildWarehousePopupHtml(warehouse))
        .addTo(map)
    }

    const handleZoomEnd = () => {
      const next = quantizeWorldScale(map)
      setWorldScale((current) => (current === next ? current : next))
    }
    map.on('zoomend', handleZoomEnd)

    // 切到其他 tab 时容器被 [hidden] 收成 0 尺寸，maplibre 不会自己感知——切回来时手动 resize 一下
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)

    const setupLayers = () => {
      if (!map.getSource(REGIONS_SOURCE)) {
        map.addSource(REGIONS_SOURCE, { type: 'geojson', data: EMPTY_FC })
        map.addSource(COLUMNS_SOURCE, { type: 'geojson', data: EMPTY_FC })
        map.addSource(ROUTE_CODES_SOURCE, { type: 'geojson', data: EMPTY_FC })
        map.addSource(WAREHOUSE_RINGS_SOURCE, {
          type: 'geojson',
          data: buildWarehouseRingCollection(warehousePointRef.current),
        })
        map.addSource(WAREHOUSE_PAD_SOURCE, {
          type: 'geojson',
          data: buildWarehousePadCollection(warehousePointRef.current),
        })
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
            // 跟柱体、填色层同一套供应商色，一眼能看出这条路由属于哪家供应商
            'text-color': ['get', 'color'],
            'text-halo-color': 'rgba(255,255,255,0.92)',
            'text-halo-width': 1.3,
            'text-opacity': ROUTE_LABEL_OPACITY,
          },
        })
      }

      const openPopup = (zipCode: string, suburb: string, lngLat: maplibregl.LngLatLike) => {
        const stat = statsRef.current.get(areaStatKey(zipCode, suburb))
        if (!stat || stat.rows.length === 0) return
        const warehouse = warehousePointRef.current
        // 主仓没配置时不编造距离——弹窗里直接不出现这条 fact，跟缺边界/缺密度同一个处理原则
        const distanceLabel =
          warehouse && stat.center
            ? formatDistanceKm(haversineKm(warehouse.lat, warehouse.lng, stat.center[1], stat.center[0]))
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
          const suburb = String(event.features?.[0]?.properties?.suburb ?? '')
          if (zipCode) openPopup(zipCode, suburb, event.lngLat)
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
      applyWarehouseRef.current()
    }

    if (map.isStyleLoaded()) setupLayers()
    else map.once('load', setupLayers)

    return () => {
      layersReadyRef.current = false
      map.off('zoomend', handleZoomEnd)
      resizeObserver.disconnect()
      warehouseMarkerRef.current?.remove()
      warehouseMarkerRef.current = null
      for (const marker of stationMarkersRef.current) marker.remove()
      stationMarkersRef.current = []
      popupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
    // regionCenter 只用于地图创建时的初始落点，地图本身只建一次，不随它变化重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 主仓 + 站点坐标异步到达/变化时：更新距离圈/落地面的 GeoJSON，创建/挪动/移除对应的 DOM marker。
  // 跟 applyRef 同一套「图层建好、数据拉到，谁先谁触发」的处理——避免数据先到而图层还没建好、
  // 或者反过来图层先建好而数据还没到，导致这层永远没机会补画上去
  useEffect(() => {
    const applyWarehouse = () => {
      const map = mapRef.current
      if (!map) return

      ;(map.getSource(WAREHOUSE_PAD_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
        buildWarehousePadCollection(warehousePoint),
      )
      ;(map.getSource(WAREHOUSE_RINGS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
        buildWarehouseRingCollection(warehousePoint),
      )

      warehouseMarkerRef.current?.remove()
      warehouseMarkerRef.current = null
      if (warehousePoint) {
        const markerEl = createWarehouseMarkerElement()
        markerEl.addEventListener('click', (event) => {
          event.stopPropagation()
          popupRef.current
            ?.setLngLat([warehousePoint.lng, warehousePoint.lat])
            .setHTML(buildWarehousePopupHtml(warehousePoint))
            .addTo(map)
        })
        warehouseMarkerRef.current = new maplibregl.Marker({ element: markerEl, anchor: 'bottom' })
          .setLngLat([warehousePoint.lng, warehousePoint.lat])
          .addTo(map)
      }

      // 站点数量不多、也不常变（运营手动维护），每次直接整体重建，不做增量 diff
      for (const marker of stationMarkersRef.current) marker.remove()
      stationMarkersRef.current = stations.map((station) => {
        const markerEl = createStationMarkerElement()
        markerEl.addEventListener('click', (event) => {
          event.stopPropagation()
          popupRef.current?.setLngLat([station.lng, station.lat]).setHTML(buildStationPopupHtml(station)).addTo(map)
        })
        return new maplibregl.Marker({ element: markerEl, anchor: 'bottom' })
          .setLngLat([station.lng, station.lat])
          .addTo(map)
      })
    }

    applyWarehouseRef.current = applyWarehouse
    if (layersReadyRef.current) applyWarehouse()
  }, [warehousePoint, stations])

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
    if (!map?.getLayer(ROUTE_CODES_LABEL)) return
    map.setLayoutProperty(ROUTE_CODES_LABEL, 'visibility', routeCodesVisible ? 'visible' : 'none')
  }, [routeCodesVisible])

  useEffect(() => {
    const map = mapRef.current
    const apply = () => {
      ;(map?.getSource(REGIONS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(regionCollection)
      ;(map?.getSource(COLUMNS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(columnCollection)
      ;(map?.getSource(ROUTE_CODES_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(routeLabelCollection)

      if (!data || !map || hasFittedOnceRef.current) return

      // 仓库坐标不参与定位——不同州仓库不同，定位只看这批数据实际落在哪
      const bounds = new maplibregl.LngLatBounds()
      for (const cell of data.cells) {
        if (cell.lng == null || cell.lat == null) continue
        bounds.extend([cell.lng, cell.lat])
      }
      if (bounds.isEmpty()) {
        map.easeTo({
          center: [regionCenter.lng, regionCenter.lat],
          zoom: ADELAIDE_MAP_ZOOM,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          duration: 800,
        })
      } else {
        map.fitBounds(bounds, {
          padding: 72,
          maxZoom: 11.6,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          duration: 800,
        })
      }
      hasFittedOnceRef.current = true
    }

    applyRef.current = apply
    if (layersReadyRef.current) apply()
  }, [columnCollection, data, regionCenter.lat, regionCenter.lng, regionCollection, routeLabelCollection])

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
            setViewPitch(map, next)
            setTopDown(next)
          }}
        >
          <Compass className="h-4 w-4" aria-hidden />
          {t(topDown ? 'reset3d' : 'topDownView')}
        </button>
        <button
          type="button"
          className="vrm-tool"
          disabled={!warehousePoint}
          title={warehousePoint ? undefined : t('warehouseNotConfiguredHint')}
          onClick={() => {
            if (!mapRef.current || !warehousePoint) return
            flyToWarehouse(mapRef.current, warehousePoint)
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
        <button
          type="button"
          className="vrm-tool"
          aria-pressed={routeCodesVisible}
          onClick={() => setRouteCodesVisible((current) => !current)}
        >
          <Route className="h-4 w-4" aria-hidden />
          {t('toggleRouteCodes')}
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

            {warehousePoint ? (
              <div className="vrm-map-legend__block">
                <div className="vrm-map-legend__wh">
                  <span className="vrm-wh-marker__pin vrm-wh-marker__pin--legend" aria-hidden>
                    <Warehouse className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <div className="vrm-map-legend__title">{t('legendWarehouse')}</div>
                    <div className="vrm-map-legend__addr">{warehousePoint.address}</div>
                  </div>
                </div>
                <div className="vrm-map-legend__rings">
                  {t('legendRings', { scale: warehouseRingScaleLabel() })}
                </div>
              </div>
            ) : warehouseLoaded ? (
              <div className="vrm-map-legend__block">
                <div className="vrm-map-legend__title">{t('legendWarehouse')}</div>
                <div className="vrm-map-legend__addr">{t('warehouseNotConfiguredHint')}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? <VendorRegionMapLoading /> : null}
    </div>
  )
}
