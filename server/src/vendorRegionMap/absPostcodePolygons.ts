import type { PostcodeGeometry } from './types'
import { normalizeZipCode } from './parseInbound'

const ABS_POA_QUERY_URL = 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0/query'
const BATCH_SIZE = 80
const REQUEST_TIMEOUT_MS = 20_000

type AbsGeoJson = {
  type?: string
  features?: Array<{
    type?: string
    properties?: Record<string, unknown>
    geometry?: PostcodeGeometry | null
  }>
}

export type AbsPolygonFeature = {
  zipCode: string
  geometry: PostcodeGeometry
}

function isPolygonGeometry(value: PostcodeGeometry | null | undefined): value is PostcodeGeometry {
  return Boolean(value && (value.type === 'Polygon' || value.type === 'MultiPolygon'))
}

async function queryAbsBatch(zipCodes: string[]): Promise<AbsPolygonFeature[]> {
  const quoted = zipCodes.map((zip) => `'${zip.replace(/'/g, "''")}'`).join(',')
  const body = new URLSearchParams({
    where: `poa_code_2021 IN (${quoted})`,
    outFields: 'poa_code_2021',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
    geometryPrecision: '4',
    maxAllowableOffset: '0.0008',
  })

  const response = await fetch(ABS_POA_QUERY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`ABS 邮编边界查询失败 HTTP ${response.status}`)
  }
  const json = (await response.json()) as AbsGeoJson
  const features: AbsPolygonFeature[] = []
  for (const feature of json.features ?? []) {
    const zipCode = normalizeZipCode(feature.properties?.poa_code_2021)
    if (!zipCode || !isPolygonGeometry(feature.geometry)) continue
    features.push({ zipCode, geometry: feature.geometry })
  }
  return features
}

/** 按收件邮编向 ABS Postal Areas 拉取简化多边形；失败时返回空，由调用方用质心兜底 */
export async function fetchAbsPostcodePolygons(zipCodes: string[]): Promise<AbsPolygonFeature[]> {
  const unique = [...new Set(zipCodes.map(normalizeZipCode).filter(Boolean))]
  if (unique.length === 0) return []

  const out: AbsPolygonFeature[] = []
  const seen = new Set<string>()
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE)
    try {
      const features = await queryAbsBatch(batch)
      for (const feature of features) {
        if (seen.has(feature.zipCode)) continue
        seen.add(feature.zipCode)
        out.push(feature)
      }
    } catch (error) {
      console.warn('[vendor-region-map] ABS 邮编边界批次失败', {
        batchSize: batch.length,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return out
}
