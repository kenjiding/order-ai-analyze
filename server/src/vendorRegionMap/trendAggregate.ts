/**
 * 供应商货量趋势聚合：把「每天一批到件扫描记录」压成按日 / 按路由码的票量序列。
 *
 * 日期由调用方按天拆好再传进来 —— iMile 到件接口返回行里没有可靠的扫描时间字段，
 * 全仓的按日口径（见 imile/inboundWaybillIndex.ts）都是一天调一次接口靠 startTime/endTime 划天。
 */

import { dedupeScansByWaybill } from './parseInbound'
import {
  buildSupplierMatcher,
  UNMATCHED_SUPPLIER_KEY,
  UNMATCHED_SUPPLIER_NAME,
  type ScopeConfig,
} from './supplierMatcher'
import type {
  VendorTrendDailyPoint,
  VendorTrendRoutePoint,
  VendorTrendSupplier,
  VendorVolumeTrendResult,
} from './types'

/** 路由码为空的扫描归入这一行，避免整批票量凭空消失 */
export const NO_ROUTE_CODE_LABEL = '(无路由码)'

export type TrendDayInput = {
  date: string
  records: unknown[]
}

function splitHalves(dates: string[]): { prev: string[]; recent: string[] } {
  if (dates.length < 2) return { prev: [], recent: [] }
  const mid = Math.floor(dates.length / 2)
  return { prev: dates.slice(0, mid), recent: dates.slice(mid) }
}

function averageOver(countByDate: Map<string, number>, dates: string[]): number {
  if (dates.length === 0) return 0
  let sum = 0
  for (const date of dates) sum += countByDate.get(date) ?? 0
  return sum / dates.length
}

export function aggregateVendorDailyVolume(input: {
  /** 已按日期升序排好、且只包含成功拉取的那些天 */
  perDay: TrendDayInput[]
  configs: ScopeConfig[]
  /** 拉取失败的日期；不计入任何统计，原样透传给前端 */
  failedDates?: string[]
  /** endDate 是今天时为 true：当天只跑了半天，混进环比会把每家都算成在掉量 */
  lastDayPartial?: boolean
  startDate: string
  endDate: string
}): VendorVolumeTrendResult {
  const matcher = buildSupplierMatcher(input.configs)
  const failedDates = [...(input.failedDates ?? [])].sort()
  const dates = input.perDay.map((day) => day.date)

  const supplierNameByKey = new Map<string, string>()
  const vendorCodeByKey = new Map<string, string>()
  /** supplierKey -> date -> count */
  const dailyCounts = new Map<string, Map<string, number>>()
  /** supplierKey -> routeCode -> date -> count */
  const routeCounts = new Map<string, Map<string, Map<string, number>>>()

  let uniqueWaybills = 0
  let unmatchedNoVendor = 0

  for (const day of input.perDay) {
    const scans = dedupeScansByWaybill(day.records)
    uniqueWaybills += scans.length

    for (const scan of scans) {
      const unitKeys = matcher.resolveUnitKeys(scan)
      const assigned = unitKeys.length > 0 ? unitKeys : [UNMATCHED_SUPPLIER_KEY]
      if (unitKeys.length === 0) unmatchedNoVendor += 1
      const routeCode = scan.routeCode.trim() || NO_ROUTE_CODE_LABEL

      for (const supplierKey of assigned) {
        const unit = matcher.units.get(supplierKey)
        supplierNameByKey.set(supplierKey, unit?.supplierName ?? UNMATCHED_SUPPLIER_NAME)
        vendorCodeByKey.set(supplierKey, unit?.vendorCode ?? '')

        const byDate = dailyCounts.get(supplierKey) ?? new Map<string, number>()
        byDate.set(day.date, (byDate.get(day.date) ?? 0) + 1)
        dailyCounts.set(supplierKey, byDate)

        const byRoute = routeCounts.get(supplierKey) ?? new Map<string, Map<string, number>>()
        const routeByDate = byRoute.get(routeCode) ?? new Map<string, number>()
        routeByDate.set(day.date, (routeByDate.get(day.date) ?? 0) + 1)
        byRoute.set(routeCode, routeByDate)
        routeCounts.set(supplierKey, byRoute)
      }
    }
  }

  // 环比只用「完整的天」：拉取失败的天本就不在 dates 里，当天不完整时再去掉最后一天
  const lastDayPartial = input.lastDayPartial === true
  const comparableDates =
    lastDayPartial && dates.length > 0 ? dates.slice(0, dates.length - 1) : [...dates]
  const { prev, recent } = splitHalves(comparableDates)

  const suppliers: VendorTrendSupplier[] = [...dailyCounts.entries()].map(
    ([supplierKey, byDate]) => {
      let totalCount = 0
      let peakCount = -1
      let peakDate = ''
      let lowCount = Number.POSITIVE_INFINITY
      let lowDate = ''
      // 峰谷要看整条日期轴，没出现的天算 0 票（那天真的没货，不是缺数据）
      for (const date of dates) {
        const count = byDate.get(date) ?? 0
        totalCount += count
        if (count > peakCount) {
          peakCount = count
          peakDate = date
        }
        if (count < lowCount) {
          lowCount = count
          lowDate = date
        }
      }

      const prevAvg = averageOver(byDate, prev)
      const recentAvg = averageOver(byDate, recent)

      const routeCodeCount = routeCounts.get(supplierKey)?.size ?? 0

      return {
        supplierKey,
        supplierName: supplierNameByKey.get(supplierKey) ?? UNMATCHED_SUPPLIER_NAME,
        vendorCode: vendorCodeByKey.get(supplierKey) ?? '',
        totalCount,
        dailyAvg: dates.length > 0 ? totalCount / dates.length : 0,
        peakCount: peakCount < 0 ? 0 : peakCount,
        peakDate,
        lowCount: Number.isFinite(lowCount) ? lowCount : 0,
        lowDate,
        prevAvg,
        recentAvg,
        // 前半段一票没有 = 区间内新增的供应商，涨跌幅无意义（不能是 Infinity）
        changeRate: prevAvg > 0 ? (recentAvg - prevAvg) / prevAvg : null,
        routeCodeCount,
      }
    },
  )

  suppliers.sort(
    (a, b) => b.totalCount - a.totalCount || a.supplierName.localeCompare(b.supplierName),
  )

  const daily: VendorTrendDailyPoint[] = []
  for (const [supplierKey, byDate] of dailyCounts) {
    for (const date of dates) {
      daily.push({ date, supplierKey, count: byDate.get(date) ?? 0 })
    }
  }

  const routeDaily: VendorTrendRoutePoint[] = []
  for (const [supplierKey, byRoute] of routeCounts) {
    for (const [routeCode, byDate] of byRoute) {
      for (const date of dates) {
        routeDaily.push({ date, supplierKey, routeCode, count: byDate.get(date) ?? 0 })
      }
    }
  }

  return {
    dates,
    suppliers,
    daily,
    routeDaily,
    meta: {
      startDate: input.startDate,
      endDate: input.endDate,
      days: dates.length,
      uniqueWaybills,
      unmatchedNoVendor,
      failedDates,
      lastDayPartial,
      comparableDates,
    },
  }
}
