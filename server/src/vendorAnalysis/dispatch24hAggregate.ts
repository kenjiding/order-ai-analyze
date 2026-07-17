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
  /** 该行数据最后一次真正从 searchWaybill 同步的时间；仅缓存行携带，用于终态判定 */
  syncedAtMs?: number
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
  /** 问题件数：见 isDispatch24hProblem 口径 */
  problemCount: number
  /** 未达标中：完全没有签收记录（signDate 为空）的件数 */
  neverSignedCount: number
  /** 未达标中：有签收记录但超过 24H 窗口才签收的件数 */
  lateSignedCount: number
  unmetWaybills: Dispatch24hUnmetWaybill[]
  /** 问题件运单明细，供落地页按运单号展示 */
  problemWaybills: Dispatch24hUnmetWaybill[]
}

export type Dispatch24hVendorStat = {
  total: number
  met: number
  /** 问题件数：见 isDispatch24hProblem 口径 */
  problemCount: number
  /** 未达标中：完全没有签收记录（signDate 为空）的件数 */
  neverSignedCount: number
  /** 未达标中：有签收记录但超过 24H 窗口才签收的件数 */
  lateSignedCount: number
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

/**
 * 问题件是否属于「本次派送」：lastProblemDate 严格晚于 deliveryTime 才算数。
 * 包裹第一次派送失败上报问题件后，可能被重新派送（第二次 deliveryTime 会晚于那次问题件时间）；
 * 这种情况下旧的问题件记录跟当前这次派送无关，不能算作本次派送产生的问题件。
 */
export function isDispatch24hProblem(row: Dispatch24hWaybillRow): boolean {
  if (!row.lastProblemDate || !row.deliveryTime) return false
  return iMileStrToMs(row.lastProblemDate) > iMileStrToMs(row.deliveryTime)
}

/** 24H 派签是否达标：周一~四 24h 内签收/问题件即达标；周五~日下周一 23:59:59（本地）前签收/问题件达标 */
export function isDispatch24hMet(row: Dispatch24hWaybillRow, tz: AusTz): boolean {
  const deadlineMs = getDispatch24hDeadlineMs(row, tz)
  if (deadlineMs == null) return false
  const signMs = row.signDate ? iMileStrToMs(row.signDate) : null
  const problemMs = isDispatch24hProblem(row) ? iMileStrToMs(row.lastProblemDate as string) : null
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
 * 终态：已达标 —— 永久成立，无需再拉。
 * 或者窗口已过 **且** 缓存本身是在窗口过后才真正同步到的 —— 此时缓存已经拿到了截止时刻的最终结果。
 * 若窗口过了但最后一次同步仍是窗口过期前的旧快照（signDate 当时可能还没来得及更新），
 * 不能直接判定终态，必须再补拉一次拿到窗口截止时刻的真实结果，否则会把「当时还没签收」
 * 错误地永久冻结成「未达标」，即使实际签收发生在截止时刻之前。
 * 供「24小时派签告警」多时段推送与「司机地图」手动刷新共用，避免已确认结果重复拉数。
 */
export function isDispatch24hTerminal(
  row: Dispatch24hWaybillRow,
  tz: AusTz,
  nowMs: number = Date.now(),
): boolean {
  if (isDispatch24hMet(row, tz)) return true
  const deadlineMs = getDispatch24hDeadlineMs(row, tz)
  if (deadlineMs == null || nowMs <= deadlineMs) return false
  return row.syncedAtMs != null && row.syncedAtMs >= deadlineMs
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
    const hasProblem = isDispatch24hProblem(row)
    const neverSigned = !met && !row.signDate
    const lateSigned = !met && Boolean(row.signDate)
    const wbNo = row.waybillNo ?? ''

    let stat = result.get(vendorCode)
    if (!stat) {
      stat = { total: 0, met: 0, problemCount: 0, neverSignedCount: 0, lateSignedCount: 0, unmetNos: [], drivers: [] }
      result.set(vendorCode, stat)
    }
    stat.total += 1
    if (met) {
      stat.met += 1
    } else if (wbNo) {
      stat.unmetNos.push(wbNo)
    }
    if (hasProblem) stat.problemCount += 1
    if (neverSigned) stat.neverSignedCount += 1
    if (lateSigned) stat.lateSignedCount += 1

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
        problemCount: 0,
        neverSignedCount: 0,
        lateSignedCount: 0,
        unmetWaybills: [],
        problemWaybills: [],
      }
      driverMap.set(courierCode, driverStat)
    }
    driverStat.total += 1
    if (met) {
      driverStat.met += 1
    } else if (wbNo) {
      driverStat.unmetWaybills.push({ waybillNo: wbNo, routeCode: consigneeRouteCode || '未知路由' })
    }
    if (hasProblem) {
      driverStat.problemCount += 1
      if (wbNo) driverStat.problemWaybills.push({ waybillNo: wbNo, routeCode: consigneeRouteCode || '未知路由' })
    }
    if (neverSigned) driverStat.neverSignedCount += 1
    if (lateSigned) driverStat.lateSignedCount += 1
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
