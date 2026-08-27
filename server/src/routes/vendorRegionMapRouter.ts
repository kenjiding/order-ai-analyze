import { Router, type Request, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { queryImileInboundScans } from '../imile/inbound'
import { LEGACY_GLOBAL_SUPPLIER_REGION_CODE, listSupplierPushConfigs } from '../supplierPushConfigs'
import { fetchAbsPostcodePolygons } from '../vendorRegionMap/absPostcodePolygons'
import { aggregateVendorZipCells } from '../vendorRegionMap/aggregate'
import { lookupPostcode } from '../vendorRegionMap/postcodeLookup'
import { readImileTokenFromRequest } from './imileAuth'

export const vendorRegionMapRouter = Router()

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 31

function parseDateKey(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!DATE_KEY_RE.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return value
}

function diffDaysInclusive(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const startMs = Date.UTC(sy, sm - 1, sd)
  const endMs = Date.UTC(ey, em - 1, ed)
  return Math.floor((endMs - startMs) / 86_400_000) + 1
}

function resolveRegionCode(req: AuthenticatedRequest): string {
  return String(req.authUser?.regionCode ?? '').trim() || LEGACY_GLOBAL_SUPPLIER_REGION_CODE
}

vendorRegionMapRouter.post('/aggregate', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { imileToken?: string; startDate?: string; endDate?: string }
    const token = readImileTokenFromRequest(req, body.imileToken)
    const startDate = parseDateKey(body.startDate)
    const endDate = parseDateKey(body.endDate)

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }
    if (!startDate || !endDate) {
      res.status(400).json({ error: '请提供有效的 startDate / endDate（YYYY-MM-DD）' })
      return
    }
    if (startDate > endDate) {
      res.status(400).json({ error: '开始日期不能晚于结束日期' })
      return
    }
    const rangeDays = diffDaysInclusive(startDate, endDate)
    if (rangeDays > MAX_RANGE_DAYS) {
      res.status(400).json({ error: `日期区间不能超过 ${MAX_RANGE_DAYS} 天` })
      return
    }

    const authReq = req as AuthenticatedRequest
    const [scanResult, configs] = await Promise.all([
      queryImileInboundScans({
        imileToken: token,
        startTime: `${startDate} 00:00:00`,
        endTime: `${endDate} 23:59:59`,
      }),
      listSupplierPushConfigs(resolveRegionCode(authReq)),
    ])

    if (!scanResult.ok) {
      res.status(502).json({
        error: scanResult.message,
        status: scanResult.status,
        rawText: scanResult.rawText,
      })
      return
    }

    const aggregated = aggregateVendorZipCells({
      records: scanResult.records,
      configs,
    })

    const zipTotals = new Map<string, number>()
    for (const cell of aggregated.cells) {
      zipTotals.set(cell.zipCode, (zipTotals.get(cell.zipCode) ?? 0) + cell.count)
    }
    const polygons = await fetchAbsPostcodePolygons([...zipTotals.keys()])
    const polygonByZip = new Map(polygons.map((item) => [item.zipCode, item.geometry]))

    const zipRegions = [...zipTotals.entries()]
      .flatMap(([zipCode, totalCount]) => {
        const geometry = polygonByZip.get(zipCode)
        if (!geometry) return []
        const geo = lookupPostcode(zipCode)
        return [
          {
            zipCode,
            suburb: geo?.suburb ?? '',
            totalCount,
            geometry,
          },
        ]
      })
      .sort((a, b) => b.totalCount - a.totalCount || a.zipCode.localeCompare(b.zipCode))

    const unmatchedNoGeo = aggregated.cells.filter((cell) => cell.lat == null || cell.lng == null).length
    const missingPolygons = [...zipTotals.keys()].filter((zipCode) => !polygonByZip.has(zipCode))

    res.json({
      vendors: aggregated.vendors,
      cells: aggregated.cells,
      zipRegions,
      meta: {
        startDate,
        endDate,
        scanFetched: scanResult.records.length,
        uniqueWaybills: aggregated.uniqueWaybills,
        matchedPackages: aggregated.matchedPackages,
        unmatchedNoZip: aggregated.unmatchedNoZip,
        unmatchedNoVendor: aggregated.unmatchedNoVendor,
        unmatchedNoGeo,
        polygonCount: zipRegions.length,
        missingPolygons,
      },
    })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message || '供应商区域地图聚合失败' })
  }
})
