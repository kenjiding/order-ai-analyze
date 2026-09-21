/**
 * 供应商货量趋势聚合 · 阶段一：把「每天一批到件扫描记录」匹配到供应商，压成按日计数。
 *
 * 日期由调用方按天拆好再传进来 —— iMile 到件接口返回行里没有可靠的扫描时间字段，
 * 全仓的按日口径（见 imile/inboundWaybillIndex.ts）都是一天调一次接口靠 startTime/endTime 划天。
 *
 * 脏数据剔除、按天/周合桶、峰谷/环比这些跟阈值/维度相关的统计（阶段二）挪到了
 * shared/vendorRegionMap/trendPeriodAggregate.ts 的纯函数里：那段逻辑只需要这里吐出的
 * 按天计数，不需要原始扫描记录，因此可以放在前端跑——用户调整脏数据阈值或切天/周维度
 * 不用重新请求接口，前后端也共用同一份实现，口径不会跑偏。
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
  VendorTrendSupplierMeta,
  VendorVolumeTrendRawResult,
} from '../../../shared/vendorRegionMap/trendPeriodAggregate'

/** 路由码为空的扫描归入这一行，避免整批票量凭空消失 */
export const NO_ROUTE_CODE_LABEL = '(无路由码)'

export type TrendDayInput = {
  date: string
  records: unknown[]
}

export function aggregateVendorDailyVolume(input: {
  /** 已按日期升序排好、且只包含成功拉取的那些天 */
  perDay: TrendDayInput[]
  configs: ScopeConfig[]
  /** 拉取失败的日期；不计入任何统计，原样透传给前端 */
  failedDates?: string[]
  /** endDate 是今天时为 true：当天只跑了半天，前端算环比时要把它排除掉 */
  lastDayPartial?: boolean
  startDate: string
  endDate: string
}): VendorVolumeTrendRawResult {
  const matcher = buildSupplierMatcher(input.configs)
  const failedDates = [...(input.failedDates ?? [])].sort()
  const dates = input.perDay.map((day) => day.date)

  const supplierNameByKey = new Map<string, string>()
  const vendorCodeByKey = new Map<string, string>()
  /** supplierKey -> date -> count */
  const dailyCounts = new Map<string, Map<string, number>>()
  /** supplierKey -> routeCode -> date -> count */
  const routeCounts = new Map<string, Map<string, Map<string, number>>>()
  const dayTotals: Record<string, number> = {}

  let uniqueWaybills = 0
  let unmatchedNoVendor = 0

  for (const day of input.perDay) {
    const scans = dedupeScansByWaybill(day.records)
    uniqueWaybills += scans.length
    dayTotals[day.date] = scans.length

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

  const supplierMeta: VendorTrendSupplierMeta[] = [...supplierNameByKey.keys()].map((supplierKey) => ({
    supplierKey,
    supplierName: supplierNameByKey.get(supplierKey) ?? UNMATCHED_SUPPLIER_NAME,
    vendorCode: vendorCodeByKey.get(supplierKey) ?? '',
  }))

  return {
    dates,
    dayTotals,
    daily,
    routeDaily,
    supplierMeta,
    meta: {
      startDate: input.startDate,
      endDate: input.endDate,
      uniqueWaybills,
      unmatchedNoVendor,
      failedDates,
      lastDayPartial: input.lastDayPartial === true,
    },
  }
}
