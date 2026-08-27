import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PostcodeCentroid } from './types'
import { normalizeZipCode } from './parseInbound'

type CentroidFile = Record<string, PostcodeCentroid>

let cached: CentroidFile | null = null

function loadCentroids(): CentroidFile {
  if (cached) return cached
  const filePath = join(dirname(fileURLToPath(import.meta.url)), 'data', 'auPostcodeCentroids.json')
  cached = JSON.parse(readFileSync(filePath, 'utf8')) as CentroidFile
  return cached
}

export function lookupPostcode(zipCode: string): PostcodeCentroid | null {
  const zip = normalizeZipCode(zipCode)
  if (!zip) return null
  return loadCentroids()[zip] ?? null
}
