import type { MultiPolygon, Polygon, Position } from 'geojson'

const EARTH_RADIUS_M = 6_371_008.8
const TO_RAD = Math.PI / 180

/**
 * 密度色阶刻意用无彩色：明度轴表达量值，色相轴留给 vendorColors 的分类色。
 * 两者分工明确，底图不会和柱体抢读。
 */
export const DENSITY_RAMP = ['#f1f5f9', '#cbd5e1', '#94a3b8', '#64748b', '#334155'] as const

/** 球面余量法（Chamberlain & Duquette），环是否显式闭合都能算 */
function ringAreaM2(ring: Position[]): number {
  if (ring.length < 3) return 0
  let total = 0
  for (let i = 0; i < ring.length; i += 1) {
    const [lng1, lat1] = ring[i]!
    const [lng2, lat2] = ring[(i + 1) % ring.length]!
    total += (lng2 - lng1) * TO_RAD * (2 + Math.sin(lat1 * TO_RAD) + Math.sin(lat2 * TO_RAD))
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2)
}

function polygonRingsAreaM2(rings: Position[][]): number {
  if (rings.length === 0) return 0
  const outer = ringAreaM2(rings[0]!)
  let holes = 0
  for (let i = 1; i < rings.length; i += 1) holes += ringAreaM2(rings[i]!)
  return Math.max(0, outer - holes)
}

export function polygonAreaKm2(geometry: Polygon | MultiPolygon): number {
  const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let m2 = 0
  for (const rings of parts) m2 += polygonRingsAreaM2(rings)
  return m2 / 1_000_000
}

/** 面积最大的外环的形心；退化时回落到该环的外接框中心 */
export function polygonCentroid(geometry: Polygon | MultiPolygon): [number, number] | null {
  const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let best: Position[] | null = null
  let bestArea = -1
  for (const rings of parts) {
    const outer = rings[0]
    if (!outer || outer.length < 3) continue
    const area = ringAreaM2(outer)
    if (area > bestArea) {
      bestArea = area
      best = outer
    }
  }
  if (!best) return null

  let twiceArea = 0
  let x = 0
  let y = 0
  for (let i = 0; i < best.length; i += 1) {
    const [x1, y1] = best[i]!
    const [x2, y2] = best[(i + 1) % best.length]!
    const cross = x1 * y2 - x2 * y1
    twiceArea += cross
    x += (x1 + x2) * cross
    y += (y1 + y2) * cross
  }
  if (Math.abs(twiceArea) > 1e-12) return [x / (3 * twiceArea), y / (3 * twiceArea)]

  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of best) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
}

export type DensityScale = {
  /** 内部切点，长度 = colors.length - 1 */
  breaks: number[]
  colors: string[]
  colorOf: (density: number) => string
  labels: () => string[]
}

/**
 * 分位分级：票/km² 在 CBD 与外围之间跨数个数量级，固定断点会把绝大多数邮区压进同一档。
 * 代价是跨日期区间颜色不可比，所以图例必须打出实际区间数值。
 */
export function quantileBreaks(values: number[], classes: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0 || classes < 2) return []
  const breaks: number[] = []
  for (let i = 1; i < classes; i += 1) {
    const pos = (i / classes) * (sorted.length - 1)
    const low = Math.floor(pos)
    const high = Math.ceil(pos)
    breaks.push(sorted[low]! + (sorted[high]! - sorted[low]!) * (pos - low))
  }
  // 重复切点会造成空档位，去掉后色阶自动收窄
  return [...new Set(breaks.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b)
}

/**
 * 丢掉会造出空档位的切点：数据偏斜时（比如只有一个 CBD 离群邮区）分位切点会挤在一起，
 * 图例上打出一个没有任何邮区落进去的区间是误导。
 */
function dropEmptyBuckets(sortedValues: number[], breaks: number[]): number[] {
  const kept: number[] = []
  let cursor = 0
  for (const value of breaks) {
    let next = cursor
    while (next < sortedValues.length && sortedValues[next]! <= value) next += 1
    if (next > cursor && next < sortedValues.length) {
      kept.push(value)
      cursor = next
    }
  }
  return kept
}

export function buildDensityScale(values: number[], classes = DENSITY_RAMP.length): DensityScale {
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0)
  const max = usable.length > 0 ? Math.max(...usable) : 0
  const breaks = dropEmptyBuckets(
    [...usable].sort((a, b) => a - b),
    quantileBreaks(usable, Math.min(classes, DENSITY_RAMP.length)),
  )
  const colors = DENSITY_RAMP.slice(DENSITY_RAMP.length - (breaks.length + 1))
  const colorOf = (density: number) => {
    let index = 0
    while (index < breaks.length && density > breaks[index]!) index += 1
    return colors[Math.min(index, colors.length - 1)]!
  }
  const labels = () => {
    const min = usable.length > 0 ? Math.min(...usable) : 0
    const edges = [min, ...breaks, max]
    return colors.map((_, index) => `${formatDensity(edges[index]!)} – ${formatDensity(edges[index + 1]!)}`)
  }
  return { breaks, colors: [...colors], colorOf, labels }
}

export function formatDensity(density: number): string {
  if (!Number.isFinite(density)) return '—'
  if (density >= 100) return density.toFixed(0)
  if (density >= 10) return density.toFixed(1)
  if (density >= 1) return density.toFixed(2)
  if (density >= 0.01) return density.toFixed(3)
  return density > 0 ? '<0.01' : '0'
}

export function formatAreaKm2(areaKm2: number): string {
  if (!Number.isFinite(areaKm2)) return '—'
  if (areaKm2 >= 100) return Math.round(areaKm2).toLocaleString('en-AU')
  if (areaKm2 >= 10) return areaKm2.toFixed(1)
  return areaKm2.toFixed(2)
}
