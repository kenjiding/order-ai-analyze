import type { MultiPolygon, Polygon, Position } from 'geojson'

const EARTH_RADIUS_M = 6_371_008.8
const TO_RAD = Math.PI / 180

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
