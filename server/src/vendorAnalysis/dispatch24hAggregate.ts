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

export type Dispatch24hUnmetWaybill = {
  waybillNo: string
  routeCode: string
}

export type Dispatch24hDriverStat = {
  courierCode: string
  courierName: string
  total: number
  met: number
  unmetWaybills: Dispatch24hUnmetWaybill[]
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

/**
 * 路由码纳入名单：供应商配置了 routeCode 时，只保留命中的运单。
 * - map 无该供应商 → 不按路由码收窄（兼容老任务 / 未配置供应商）
 * - map 有该供应商但集合为空 → 无匹配
 */
export function isRouteCodeAllowed(
  vendorCode: string,
  routeCode: string,
  routeCodesByVendor: Map<string, Set<string>>,
): boolean {
  const allowed = routeCodesByVendor.get(vendorCode)
  if (!allowed) return true
  return allowed.has(routeCode.trim())
}

/**
 * 24H 派签窗口截止时刻（本地时区）：
 * - 周一~四：派件后 24h
 * - 周五~日：下周一 23:59:59
 * 无 deliveryTime 时无法判定窗口，返回 null。
 */
export function getDispatch24hDeadlineMs(row: Dispatch24hWaybillRow, tz: AusTz): number | null {
  if (!row.deliveryTime) return null
  const deliveryMs = iMileStrToMs(row.deliveryTime)
  const dow = weekdayInTz(deliveryMs, tz) // 0=周日 … 6=周六
  if (dow >= 1 && dow <= 4) return deliveryMs + DAY_MS
  const daysToMonday = dow === 0 ? 1 : dow === 5 ? 3 : 2
  return localDatePlusDaysMs(deliveryMs, tz, daysToMonday, 23, 59, 59)
}

/** 24H 派签是否达标：周一~四 24h 内签收/问题件即达标；周五~日下周一 23:59:59（本地）前签收/问题件达标 */
export function isDispatch24hMet(row: Dispatch24hWaybillRow, tz: AusTz): boolean {
  const deadlineMs = getDispatch24hDeadlineMs(row, tz)
  if (deadlineMs == null) return false
  const signMs = row.signDate ? iMileStrToMs(row.signDate) : null
  const problemMs = row.lastProblemDate ? iMileStrToMs(row.lastProblemDate) : null
  const beforeDeadline = (ms: number | null) => ms != null && ms <= deadlineMs
  return beforeDeadline(signMs) || beforeDeadline(problemMs)
}

/** 派签窗口是否已过（与是否达标无关）；无 deliveryTime 时视为未过期，避免误跳过仍可能补到派件时间的单 */
export function isDispatch24hWindowExpired(
  row: Dispatch24hWaybillRow,
  tz: AusTz,
  nowMs: number = Date.now(),
): boolean {
  const deadlineMs = getDispatch24hDeadlineMs(row, tz)
  return deadlineMs != null && nowMs > deadlineMs
}

/**
 * 终态：已达标，或窗口已过（无论达标与否都无需再拉 searchWaybill）。
 * 供「24小时派签告警」多时段推送与「司机地图」手动刷新共用，避免已确认结果重复拉数。
 */
export function isDispatch24hTerminal(
  row: Dispatch24hWaybillRow,
  tz: AusTz,
  nowMs: number = Date.now(),
): boolean {
  if (isDispatch24hMet(row, tz)) return true
  return isDispatch24hWindowExpired(row, tz, nowMs)
}

/**
 * 从到件索引中筛出仍需重新 searchWaybill 的单号：
 * - 缓存中不存在 → 需要拉
 * - 缓存存在但未终态（未达标且窗口未过）→ 需要拉
 * - 已达标 / 已超窗口 → 跳过
 */
export function selectWaybillNosNeedingRefresh(
  indexWaybillNos: string[],
  cachedByWaybillNo: Map<string, Dispatch24hWaybillRow>,
  tz: AusTz,
  nowMs: number = Date.now(),
): string[] {
  const need: string[] = []
  for (const waybillNo of indexWaybillNos) {
    const no = waybillNo.trim()
    if (!no) continue
    const cached = cachedByWaybillNo.get(no)
    if (!cached || !isDispatch24hTerminal(cached, tz, nowMs)) need.push(no)
  }
  return need
}

/**
 * 按供应商（courierVendorCode）聚合 24H 派签达标情况：
 * courierVendorCode → routeCode 纳入 → 路由码白名单剔除 → 站点（lastScanSiteCode）→ 达标判定；
 * 同时按司机（courierCode）细分未达标数，供告警卡片展示司机维度明细。
 * 口径与「供应商数据分析」大盘 / 「24小时派签告警」一致。
 */
export function aggregateDispatch24hByVendor(input: {
  rows: Dispatch24hWaybillRow[]
  stationCodes: string[]
  tz: AusTz
  /** 路由码纳入名单；缺省空 map = 不按路由码收窄 */
  routeCodesByVendor?: Map<string, Set<string>>
  routeCodeWhitelistByVendor: Map<string, Set<string>>
}): Map<string, Dispatch24hVendorStat> {
  const {
    rows,
    stationCodes,
    tz,
    routeCodesByVendor = new Map(),
    routeCodeWhitelistByVendor,
  } = input
  const stationSet = new Set(stationCodes.map((s) => s.trim()).filter(Boolean))
  const inStation = (code: string | undefined) => stationSet.size === 0 || stationSet.has(norm(code))

  const result = new Map<string, Dispatch24hVendorStat>()
  const driverMapByVendor = new Map<string, Map<string, Dispatch24hDriverStat>>()

  for (const row of rows) {
    const vendorCode = norm(row.courierVendorCode)
    if (!vendorCode) continue
    const consigneeRouteCode = norm(row.consigneeRouteCode)
    if (!isRouteCodeAllowed(vendorCode, consigneeRouteCode, routeCodesByVendor)) continue
    if (isWhitelisted(vendorCode, consigneeRouteCode, routeCodeWhitelistByVendor)) continue
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
      driverStat = {
        courierCode,
        courierName: row.courier?.trim() || courierCode,
        total: 0,
        met: 0,
        unmetWaybills: [],
      }
      driverMap.set(courierCode, driverStat)
    }
    driverStat.total += 1
    if (met) {
      driverStat.met += 1
    } else if (wbNo) {
      driverStat.unmetWaybills.push({ waybillNo: wbNo, routeCode: consigneeRouteCode || '未知路由' })
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
