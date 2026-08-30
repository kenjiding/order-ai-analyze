import { Router, type Request, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { AUS_TZ } from '../imile/ausTimezone'
import { queryImileInboundScans } from '../imile/inbound'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { mapWithConcurrency } from '../orderAnalyze/runtime'
import { LEGACY_GLOBAL_SUPPLIER_REGION_CODE, listSupplierPushConfigs } from '../supplierPushConfigs'
import { fetchAbsPostcodePolygons } from '../vendorRegionMap/absPostcodePolygons'
import { aggregateVendorZipCells } from '../vendorRegionMap/aggregate'
import { lookupPostcode } from '../vendorRegionMap/postcodeLookup'
import { aggregateVendorDailyVolume, type TrendDayInput } from '../vendorRegionMap/trendAggregate'
import { readImileTokenFromRequest } from './imileAuth'

export const vendorRegionMapRouter = Router()

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 31
/** 趋势按天逐日调 iMile，并发过高会触发限流；4 路是吞吐与稳定的折中 */
const TREND_DAY_CONCURRENCY = 4

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

/** 展开为闭区间的日期列表；调用方已校验过格式与 31 天上限 */
function enumerateDates(startDate: string, endDate: string): string[] {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const dates: string[] = []
  let cursor = Date.UTC(sy, sm - 1, sd)
  for (;;) {
    const dt = new Date(cursor)
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
    if (key > endDate) break
    dates.push(key)
    cursor += 86_400_000
  }
  return dates
}

vendorRegionMapRouter.post('/trend', async (req: Request, res: Response) => {
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
    if (diffDaysInclusive(startDate, endDate) > MAX_RANGE_DAYS) {
      res.status(400).json({ error: `日期区间不能超过 ${MAX_RANGE_DAYS} 天` })
      return
    }

    const authReq = req as AuthenticatedRequest
    const dates = enumerateDates(startDate, endDate)

    // 到件接口返回行里没有可靠的扫描时间字段，只能一天调一次靠 startTime/endTime 划天。
    // 时区口径与 /aggregate 保持一致（朴素本地串），保证趋势各天求和 == 地图同区间总量。
    const [dayResults, configs] = await Promise.all([
      mapWithConcurrency(dates, TREND_DAY_CONCURRENCY, async (date) => {
        const result = await queryImileInboundScans({
          imileToken: token,
          startTime: `${date} 00:00:00`,
          endTime: `${date} 23:59:59`,
        })
        return { date, result }
      }),
      listSupplierPushConfigs(resolveRegionCode(authReq)),
    ])

    const perDay: TrendDayInput[] = []
    const failedDates: string[] = []
    const failures: { date: string; message: string }[] = []
    for (const { date, result } of dayResults) {
      if (result.ok) {
        perDay.push({ date, records: result.records })
        continue
      }
      // 失败的天不当作 0 票，否则趋势会凭空出现一个谷、环比整体被拉垮
      failedDates.push(date)
      failures.push({ date, message: result.message })
    }

    if (perDay.length === 0) {
      res.status(502).json({
        error: failures[0]?.message ?? '到件数据拉取失败',
        failedDates,
      })
      return
    }

    const todayStr = getRegionNow(AUS_TZ.Adelaide).dateStr
    const aggregated = aggregateVendorDailyVolume({
      perDay,
      configs,
      failedDates,
      lastDayPartial: endDate >= todayStr,
      startDate,
      endDate,
    })

    res.json(aggregated)
  } catch (error) {
    res.status(500).json({ error: (error as Error).message || '供应商货量趋势聚合失败' })
  }
})
