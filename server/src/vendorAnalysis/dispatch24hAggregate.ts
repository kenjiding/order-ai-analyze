/**
 * 24H 派签率——达标判定与按供应商聚合的纯函数。
 *
 * 从 vendorAnalysis/aggregate.ts 抽出，供「供应商数据分析」大盘与独立的
 * 「24小时派签告警」（feishu/dispatchAlarmScheduledPush.ts）共用同一套判定口径，
 * 不重复实现。
 */
import { iMileStrToMs, localDatePlusDaysMs, weekdayInTz, type AusTz } from '../imile/ausTimezone'

const DAY_MS = 24 * 60 * 60 * 1000

export type Dispatch24hWaybillRow = {
  waybillNo?: string
  courier?: string
  courierCode?: string
  courierVendorCode?: string
  consigneeRouteCode?: string
  signDate?: string
  deliveryTime?: string
  lastScanSiteCode?: string
  lastProblemDate?: string
}

export type Dispatch24hDriverStat = {
  courierCode: string
  courierName: string
  total: number
  met: number
  unmetNos: string[]
}

export type Dispatch24hVendorStat = {
  total: number
  met: number
  unmetNos: string[]
  /** 按司机（courierCode）细分的达标情况，按未达标数从高到低排序 */
  drivers: Dispatch24hDriverStat[]
}

function norm(code: unknown): string {
  return typeof code === 'string' ? code.trim() : ''
}

/** 路由码白名单命中：该供应商这条数据要剔除，不参与统计 */
function isWhitelisted(
  vendorCode: string,
  routeCode: string,
  routeCodeWhitelistByVendor: Map<string, Set<string>>,
): boolean {
  return routeCodeWhitelistByVendor.get(vendorCode)?.has(routeCode.trim()) ?? false
}

/** 24H 派签是否达标：周一~四 24h 内签收/问题件即达标；周五~日下周一 23:59:59（本地）前签收达标 */
export function isDispatch24hMet(row: Dispatch24hWaybillRow, tz: AusTz): boolean {
  if (!row.deliveryTime) return false
  const deliveryMs = iMileStrToMs(row.deliveryTime)
  const signMs = row.signDate ? iMileStrToMs(row.signDate) : null
  const problemMs = row.lastProblemDate ? iMileStrToMs(row.lastProblemDate) : null
  const dow = weekdayInTz(deliveryMs, tz) // 0=周日 … 6=周六

  if (dow >= 1 && dow <= 4) {
    const within24h = (ms: number | null) => ms != null && ms - deliveryMs <= DAY_MS
    return within24h(signMs) || within24h(problemMs)
  }
  // 周五(5)/周六(6)/周日(0)：下周一 23:59:59（targetTz 本地）前签收达标
  const daysToMonday = dow === 0 ? 1 : dow === 5 ? 3 : 2
  const nextMondayMs = localDatePlusDaysMs(deliveryMs, tz, daysToMonday, 23, 59, 59)
  return signMs != null && signMs <= nextMondayMs
}

/**
 * 按供应商（courierVendorCode）聚合 24H 派签达标情况：按站点（lastScanSiteCode）
 * 与路由码白名单过滤后，统计达标/未达标运单；同时按司机（courierCode）细分未达标数，
 * 供告警卡片展示司机维度明细。口径与「供应商数据分析」大盘一致。
 */
export function aggregateDispatch24hByVendor(input: {
  rows: Dispatch24hWaybillRow[]
  stationCodes: string[]
  tz: AusTz
  routeCodeWhitelistByVendor: Map<string, Set<string>>
}): Map<string, Dispatch24hVendorStat> {
  const { rows, stationCodes, tz, routeCodeWhitelistByVendor } = input
  const stationSet = new Set(stationCodes.map((s) => s.trim()).filter(Boolean))
  const inStation = (code: string | undefined) => stationSet.size === 0 || stationSet.has(norm(code))

  const result = new Map<string, Dispatch24hVendorStat>()
  const driverMapByVendor = new Map<string, Map<string, Dispatch24hDriverStat>>()

  for (const row of rows) {
    const vendorCode = norm(row.courierVendorCode)
    if (!vendorCode) continue
    if (isWhitelisted(vendorCode, norm(row.consigneeRouteCode), routeCodeWhitelistByVendor)) continue
    if (!inStation(row.lastScanSiteCode)) continue
    if (!row.deliveryTime) continue
    const met = isDispatch24hMet(row, tz)
    const wbNo = row.waybillNo ?? ''

    let stat = result.get(vendorCode)
    if (!stat) {
      stat = { total: 0, met: 0, unmetNos: [], drivers: [] }
      result.set(vendorCode, stat)
    }
    stat.total += 1
    if (met) {
      stat.met += 1
    } else if (wbNo) {
      stat.unmetNos.push(wbNo)
    }

    const courierCode = norm(row.courierCode)
    if (!courierCode) continue
    let driverMap = driverMapByVendor.get(vendorCode)
    if (!driverMap) {
      driverMap = new Map()
      driverMapByVendor.set(vendorCode, driverMap)
    }
    let driverStat = driverMap.get(courierCode)
    if (!driverStat) {
      driverStat = { courierCode, courierName: row.courier?.trim() || courierCode, total: 0, met: 0, unmetNos: [] }
      driverMap.set(courierCode, driverStat)
    }
    driverStat.total += 1
    if (met) {
      driverStat.met += 1
    } else if (wbNo) {
      driverStat.unmetNos.push(wbNo)
    }
  }

  for (const [vendorCode, driverMap] of driverMapByVendor) {
    const stat = result.get(vendorCode)
    if (!stat) continue
    stat.drivers = [...driverMap.values()].sort(
      (a, b) => (b.total - b.met) - (a.total - a.met) || b.total - a.total,
    )
  }

  return result
}
