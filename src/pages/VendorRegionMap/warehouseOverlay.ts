import type { Feature, FeatureCollection } from 'geojson'
import { regularPolygon } from './columnGeometry'
import { WAREHOUSE, WAREHOUSE_RING_KM, warehouseRingScaleLabel } from './vendorRegionMapTypes'

const EARTH_RADIUS_KM = 6371

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

export function buildWarehousePadCollection(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'pad' },
        geometry: {
          type: 'Polygon',
          coordinates: [regularPolygon(WAREHOUSE.lng, WAREHOUSE.lat, 160, 36)],
        },
      },
    ],
  }
}

export function buildWarehouseRingCollection(): FeatureCollection {
  const features: Feature[] = []
  for (const km of WAREHOUSE_RING_KM) {
    const radiusM = km * 1000
    features.push({
      type: 'Feature',
      properties: { km, label: `${km} km` },
      geometry: {
        type: 'LineString',
        coordinates: regularPolygon(WAREHOUSE.lng, WAREHOUSE.lat, radiusM, Math.max(96, Math.round(km * 1.2))),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function buildWarehousePopupHtml(): string {
  return `
    <div class="vrm-iw vrm-iw--warehouse">
      <div class="vrm-iw__head">
        <div class="vrm-iw__zip">${WAREHOUSE.name}</div>
      </div>
      <div class="vrm-iw__wh-body">
        <div class="vrm-iw__wh-addr">${WAREHOUSE.address}</div>
        <div class="vrm-iw__wh-hint">同心圆为距仓库 ${warehouseRingScaleLabel()}，放大后自动淡出</div>
      </div>
    </div>`
}

export const RING_CHIP_IMAGE_ID = 'vrm-ring-chip'

/**
 * 距离数字的白底药丸，画成可拉伸的地图图标（stretchX/Y + icon-text-fit）。
 * 用图标而不是纯描边文字，是为了让「50 km」在极淡的虚线上依然抢眼；
 * 药丸会随文字宽度自动拉伸，"10 km" 和 "150 km" 都贴合。
 */
export function createRingChipImage(): {
  data: ImageData
  options: { pixelRatio: number; stretchX: [number, number][]; stretchY: [number, number][]; content: [number, number, number, number] }
} | null {
  const ratio = 2
  const width = 26 * ratio
  const height = 18 * ratio
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof ctx.roundRect !== 'function') return null

  const inset = 1.5 * ratio
  const radius = (height - inset * 2) / 2
  ctx.beginPath()
  ctx.roundRect(inset, inset, width - inset * 2, height - inset * 2, radius)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.lineWidth = 1.4 * ratio
  ctx.strokeStyle = '#1f6f68'
  ctx.stroke()

  return {
    data: ctx.getImageData(0, 0, width, height),
    options: {
      pixelRatio: ratio,
      // 只拉伸中间一小段，两头的圆角保持原样
      stretchX: [[radius + inset, width - radius - inset]],
      stretchY: [[height / 2 - ratio, height / 2 + ratio]],
      content: [radius + inset, inset * 2, width - radius - inset, height - inset * 2],
    },
  }
}

export function createWarehouseMarkerElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'vrm-wh-marker'
  el.innerHTML = `
    <div class="vrm-wh-marker__pin" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 21V8l9-5 9 5v13"/>
        <path d="M9 21v-8h6v8"/>
      </svg>
    </div>
    <div class="vrm-wh-marker__label">仓库</div>
  `
  return el
}
