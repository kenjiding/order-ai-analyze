/**
 * 24H 派签率——达标判定与按供应商聚合的纯函数。
 *
 * 从 vendorAnalysis/aggregate.ts 抽出，供「供应商数据分析」大盘、独立的
 * 「24小时派签告警」（feishu/dispatchAlarmScheduledPush.ts）与「出仓派签达成分析」
 * （dispatch24hStats/）共用同一套判定口径，不重复实现。
 *
 * 窗口口径按「到件日 D」判定（resolveDispatch24hWindowRule），不是按某一单碰巧哪天出仓判定——
 * 一批货同属一个到件批次，不能因为其中一单出仓晚了一天就换一套截止规则。
 */
import { iMileStrToMs, localDateTimeToMs, type AusTz } from '../imile/ausTimezone'
import { isSortingWorkday, nextSortingWorkdayAfter } from '../imile/sortingWorkday'
import {
  buildRouteCodeVendorsMap,
  isRowInVendorScope,
  resolveConfigScopesForRow,
  resolveVendorCodesByRouteCode,
  type ConfigScope,
} from './supplierScope'

const DAY_MS = 24 * 60 * 60 * 1000

export type Dispatch24hWaybillRow = {
  waybillNo?: string
  courier?: string
  courierCode?: string
  courierVendorCode?: string
  consigneeRouteCode?: string
  /** 商家编码；与「优先客户配置」比对得出是否「本地件优先客户」包裹 */
  clientCode?: string
  signDate?: string
  deliveryTime?: string
  lastScanSiteCode?: string
  /** 收件邮编（iMile consigneeZipCode，已归一成 4 位）；与 suburb 一起匹配区域包裹价格 */
  postcode?: string
  /** 收件 suburb（iMile consigneeCity） */
  suburb?: string
  lastProblemDate?: string
  /** 该行数据最后一次真正从 searchWaybill 同步的时间；仅缓存行携带，用于终态判定 */
  syncedAtMs?: number
  /** 多到件日合并统计时，该行所属到件日的窗口规则；不设则用聚合传入的 rule（单到件日的常规情况） */
  windowRule?: Dispatch24hWindowRule
}

export type Dispatch24hUnmetWaybill = {
  waybillNo: string
  routeCode: string
  /** 是否「本地件优先客户」包裹，供告警落地页高亮标出 */
  isPriority?: boolean
}

export type Dispatch24hDriverStat = {
  courierCode: string
  courierName: string
  /** 该司机首条运单的路由码，供分析页司机行展示 */
  routeCode: string
  total: number
  met: number
  /** 问题件数：见 isDispatch24hProblem 口径 */
  problemCount: number
  /** 未达标中：完全没有签收记录（signDate 为空）的件数 */
  neverSignedCount: number
  /** 未达标中：有签收记录但超过 24H 窗口才签收的件数 */
  lateSignedCount: number
  /** 「本地件优先客户」包裹数（clientCode 命中优先客户配置） */
  priorityTotal: number
  /** 「本地件优先客户」包裹中尚未签收（未派完）的件数；本次派送已上报问题件视同已签收，与 24H 派签口径一致 */
  priorityUnsigned: number
  /** 从未签收的运单明细，供告警落地页按运单号展示 */
  neverSignedWaybills: Dispatch24hUnmetWaybill[]
  /** 签收但超过 24H 窗口才签收的运单明细，供告警落地页按运单号展示 */
  lateSignedWaybills: Dispatch24hUnmetWaybill[]
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
  /** 「本地件优先客户」包裹数（clientCode 命中优先客户配置） */
  priorityTotal: number
  /** 「本地件优先客户」包裹中尚未签收（未派完）的件数；本次派送已上报问题件视同已签收，与 24H 派签口径一致 */
  priorityUnsigned: number
  unmetNos: string[]
  /** 按司机（courierCode）细分的达标情况，按未达标数从高到低排序 */
  drivers: Dispatch24hDriverStat[]
  /**
   * 没有 courierCode（尚未派件/未分配司机）的那部分单，单独成桶，courierCode/courierName 为空。
   * 不混进 drivers（那是真实司机绩效维度），但推送卡片/落地页必须显示它，
   * 否则「未达标 N 单」与司机明细对不上，会出现「16 单未签收」却写「全部已签收」的自相矛盾。
   */
  unassigned: Dispatch24hDriverStat | null
}

function norm(code: unknown): string {
  return typeof code === 'string' ? code.trim() : ''
}

/** 该单是否属于「本地件优先客户」：clientCode 命中「优先客户配置」的商家编码（大写比较） */
export function isPriorityRow(row: Dispatch24hWaybillRow, priorityClientCodes?: Set<string>): boolean {
  if (!priorityClientCodes || priorityClientCodes.size === 0) return false
  return priorityClientCodes.has(norm(row.clientCode).toUpperCase())
}

/**
 * 24H 派签窗口规则，**按到件日 D 判定**（不是按 deliveryTime 的星期）。
 *
 * 一批货的窗口口径由它「哪天到件」决定，而不是由某一单碰巧哪天出仓决定：
 * - D ∈ 周一~周四 → 出仓日 O = D+1，每单各自 deliveryTime + 24h
 * - D ∈ 周五/周六/周日 → 出仓日 O = 下周一 11:00（见 resolveExitDate），但周日不派送，
 *   整批派签共用一个固定截止时刻：D 之后第一个周一 23:59:59（本地时区）
 *
 * 一次聚合只解析一次日期，逐行判定复用同一个 rule，避免每行重复解析时区。
 */
export type Dispatch24hWindowRule =
  | { kind: 'rolling24h' }
  | { kind: 'fixedDeadline'; deadlineMs: number }

/** 到件日 D 之后第一个周一（含跨周），返回 YYYY-MM-DD */
function nextMondayAfter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const cur = new Date(Date.UTC(y, m - 1, d))
  do {
    cur.setUTCDate(cur.getUTCDate() + 1)
  } while (cur.getUTCDay() !== 1)
  return cur.toISOString().slice(0, 10)
}

/** 按到件日 D（YYYY-MM-DD，账号州时区的本地日历日）解析本批次的 24H 派签窗口规则 */
export function resolveDispatch24hWindowRule(arrivalDateStr: string, tz: AusTz): Dispatch24hWindowRule {
  // 周五/周末到件：周日不派送，派签整批顺延到下周一；其余工作日到件走滚动 24h。
  // 周末到件（周末不开仓分拣，理论上无批次）同样压到下周一兜底。
  const [y, m, d] = arrivalDateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=周日 … 6=周六
  if (isSortingWorkday(arrivalDateStr) && dow !== 5) return { kind: 'rolling24h' }
  return {
    kind: 'fixedDeadline',
    deadlineMs: localDateTimeToMs(`${nextMondayAfter(arrivalDateStr)} 23:59:59`, tz),
  }
}

/**
 * 到件日 D 的出仓日 O = 下一个分拣工作日（nextSortingWorkdayAfter）。
 *
 * 周一～周四：O = D+1。周五/周六/周日：O = 下周一。「11点前出仓」截止即 O 当天 11:00。
 * 与 computeBefore11ThresholdMs（供应商数据分析）同口径。
 */
export function resolveExitDate(arrivalDateStr: string): string {
  return nextSortingWorkdayAfter(arrivalDateStr)
}

/** 到件日 D 的出仓日 O 当天 hh:mm 对应的 UTC 毫秒——出仓阈值与结算时机共用 */
export function dispatchExitThresholdMs(arrivalDateStr: string, tz: AusTz, timeHHmm = '11:00'): number {
  return localDateTimeToMs(`${resolveExitDate(arrivalDateStr)} ${timeHHmm}:00`, tz)
}

/**
 * 单件的 24H 派签窗口截止时刻。无 deliveryTime 时滚动窗口无法起算，返回 null；
 * 固定截止的批次（周五/周末到件）与是否已派件无关，始终返回该批次的统一截止时刻。
 */
export function getDispatch24hDeadlineMs(
  row: Dispatch24hWaybillRow,
  rule: Dispatch24hWindowRule,
): number | null {
  // 行自带规则优先：多到件日合并统计时每行的窗口口径由它自己那天的到件日决定
  const effectiveRule = row.windowRule ?? rule
  if (effectiveRule.kind === 'fixedDeadline') return effectiveRule.deadlineMs
  if (!row.deliveryTime) return null
  return iMileStrToMs(row.deliveryTime) + DAY_MS
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

/** 24H 派签是否达标：在本批次窗口（见 resolveDispatch24hWindowRule）截止前签收或产生本次派送的问题件 */
export function isDispatch24hMet(row: Dispatch24hWaybillRow, rule: Dispatch24hWindowRule): boolean {
  const deadlineMs = getDispatch24hDeadlineMs(row, rule)
  if (deadlineMs == null) return false
  const signMs = row.signDate ? iMileStrToMs(row.signDate) : null
  const problemMs = isDispatch24hProblem(row) ? iMileStrToMs(row.lastProblemDate as string) : null
  const beforeDeadline = (ms: number | null) => ms != null && ms <= deadlineMs
  return beforeDeadline(signMs) || beforeDeadline(problemMs)
}

/** 派签窗口是否已过（与是否达标无关）；无 deliveryTime 时视为未过期，避免误跳过仍可能补到派件时间的单 */
export function isDispatch24hWindowExpired(
  row: Dispatch24hWaybillRow,
  rule: Dispatch24hWindowRule,
  nowMs: number = Date.now(),
): boolean {
  const deadlineMs = getDispatch24hDeadlineMs(row, rule)
  return deadlineMs != null && nowMs > deadlineMs
}

/**
 * 终态：已达标 —— 永久成立，无需再拉。
 * 或者已经拿到签收时间（不论是否超窗口）—— signDate 一旦写入就不会再变化，达标/超时的结论已经确定。
 * 窗口已过但仍未拿到签收时间时，**不能**视为终态：iMile 侧的签收记录可能在窗口过后才姗姗来迟写入
 * （即「签收超时」而非「未签收」），必须持续重新拉取直到真正拿到 signDate，否则会把「当时还没签收」
 * 永久误判成「永远不会签收」。
 * 供「24小时派签告警」多时段推送与「司机地图」手动刷新共用，避免已确认结果重复拉数。
 */
export function isDispatch24hTerminal(row: Dispatch24hWaybillRow, rule: Dispatch24hWindowRule): boolean {
  return isDispatch24hMet(row, rule) || Boolean(row.signDate)
}

/**
 * 从到件索引中筛出仍需重新 searchWaybill 的单号：
 * - 缓存中不存在 → 需要拉
 * - 缓存存在但未终态（未达标且尚未拿到签收时间）→ 需要拉
 * - 已达标 / 已拿到签收时间 → 跳过
 */
export function selectWaybillNosNeedingRefresh(
  indexWaybillNos: string[],
  cachedByWaybillNo: Map<string, Dispatch24hWaybillRow>,
  rule: Dispatch24hWindowRule,
): string[] {
  const need: string[] = []
  for (const waybillNo of indexWaybillNos) {
    const no = waybillNo.trim()
    if (!no) continue
    const cached = cachedByWaybillNo.get(no)
    if (!cached || !isDispatch24hTerminal(cached, rule)) need.push(no)
  }
  return need
}

/**
 * 按供应商聚合 24H 派签达标情况：
 * courierVendorCode 有值 → 按它归属（唯一）；为空（尚未派件）→ 按 consigneeRouteCode 匹配所有配置了
 * 该路由码的供应商，各自独立统计——两家供应商共担同一路由码是正常业务场景，不存在"归谁"的排他判断，
 * 各供应商按自己配置的路由码独立匹配、独立计数即可（见 buildRouteCodeVendorsMap）。
 * 匹配到的每个供应商还要再过 routeCode 纳入 → 路由码白名单剔除 → 站点（lastScanSiteCode）三关；
 * 尚未派件（无 deliveryTime）的单也计入 total，按未达标处理（归入「从未签收」）——
 * 因为该供应商范围内的单，只要还没派件，24H 派签就必然不达标，不能因为拿不到 deliveryTime 就当它不存在。
 * 同时按司机（courierCode）细分未达标数，供告警卡片展示司机维度明细；
 * 未派件的单没有司机可归（courierCode 同样为空），归入单独的 unassigned 桶，不混进 drivers。
 * 口径与「供应商数据分析」大盘 / 「24小时派签告警」一致。
 */
/** 司机维度累加：供 aggregateDispatch24hByVendor / aggregateDispatch24hByScopes 共用，二者除是否额外记 unmetNos 外，司机级累加逻辑完全一致 */
function accumulateDriverStat(
  driverMapByKey: Map<string, Map<string, Dispatch24hDriverStat>>,
  key: string,
  row: Dispatch24hWaybillRow,
  consigneeRouteCode: string,
  courierCode: string,
  met: boolean,
  hasProblem: boolean,
  neverSigned: boolean,
  lateSigned: boolean,
  isPriority: boolean,
  wbNo: string,
): void {
  // courierCode 为空（尚未派件/未分配司机）时用空串当桶 key，finalizeDriverStats 再拆到 stat.unassigned
  let driverMap = driverMapByKey.get(key)
  if (!driverMap) {
    driverMap = new Map()
    driverMapByKey.set(key, driverMap)
  }
  let driverStat = driverMap.get(courierCode)
  if (!driverStat) {
    driverStat = {
      courierCode,
      courierName: row.courier?.trim() || courierCode,
      routeCode: consigneeRouteCode,
      total: 0,
      met: 0,
      problemCount: 0,
      neverSignedCount: 0,
      lateSignedCount: 0,
      priorityTotal: 0,
      priorityUnsigned: 0,
      neverSignedWaybills: [],
      lateSignedWaybills: [],
      problemWaybills: [],
    }
    driverMap.set(courierCode, driverStat)
  }
  driverStat.total += 1
  if (met) {
    driverStat.met += 1
  } else if (wbNo) {
    const waybill = { waybillNo: wbNo, routeCode: consigneeRouteCode || '未知路由', isPriority }
    if (neverSigned) driverStat.neverSignedWaybills.push(waybill)
    if (lateSigned) driverStat.lateSignedWaybills.push(waybill)
  }
  if (hasProblem) {
    driverStat.problemCount += 1
    if (wbNo) driverStat.problemWaybills.push({ waybillNo: wbNo, routeCode: consigneeRouteCode || '未知路由', isPriority })
  }
  if (neverSigned) driverStat.neverSignedCount += 1
  if (lateSigned) driverStat.lateSignedCount += 1
  if (isPriority) {
    driverStat.priorityTotal += 1
    // 本次派送已上报问题件视同已签收，与 24H 派签达标口径一致
    if (!row.signDate && !hasProblem) driverStat.priorityUnsigned += 1
  }
}

/** 把每个 key 下按司机聚出的明细排序、挂回对应 stat.drivers；未达标数从高到低。无司机的桶拆到 stat.unassigned */
function finalizeDriverStats(
  result: Map<string, Dispatch24hVendorStat>,
  driverMapByKey: Map<string, Map<string, Dispatch24hDriverStat>>,
): void {
  for (const [key, driverMap] of driverMapByKey) {
    const stat = result.get(key)
    if (!stat) continue
    const unassigned = driverMap.get('')
    if (unassigned) {
      driverMap.delete('')
      stat.unassigned = unassigned
    }
    stat.drivers = [...driverMap.values()].sort(
      (a, b) => (b.total - b.met) - (a.total - a.met) || b.total - a.total,
    )
  }
}

export function aggregateDispatch24hByVendor(input: {
  rows: Dispatch24hWaybillRow[]
  stationCodes: string[]
  rule: Dispatch24hWindowRule
  /** 路由码纳入名单；缺省空 map = 不按路由码收窄 */
  routeCodesByVendor?: Map<string, Set<string>>
  routeCodeWhitelistByVendor: Map<string, Set<string>>
  /** 「优先客户配置」商家编码（大写）；缺省 = 不统计优先件 */
  priorityClientCodes?: Set<string>
}): Map<string, Dispatch24hVendorStat> {
  const {
    rows,
    stationCodes,
    rule,
    routeCodesByVendor = new Map(),
    routeCodeWhitelistByVendor,
    priorityClientCodes,
  } = input
  const stationSet = new Set(stationCodes.map((s) => s.trim()).filter(Boolean))
  const inStation = (code: string | undefined) => stationSet.size === 0 || stationSet.has(norm(code))
  const routeCodeVendorsMap = buildRouteCodeVendorsMap(routeCodesByVendor)

  const result = new Map<string, Dispatch24hVendorStat>()
  const driverMapByVendor = new Map<string, Map<string, Dispatch24hDriverStat>>()

  for (const row of rows) {
    const consigneeRouteCode = norm(row.consigneeRouteCode)
    const explicitVendorCode = norm(row.courierVendorCode)
    const candidateVendorCodes = explicitVendorCode
      ? [explicitVendorCode]
      : resolveVendorCodesByRouteCode(consigneeRouteCode, routeCodeVendorsMap)
    if (candidateVendorCodes.length === 0) continue
    if (!inStation(row.lastScanSiteCode)) continue

    const met = isDispatch24hMet(row, rule)
    const hasProblem = isDispatch24hProblem(row)
    const neverSigned = !met && !row.signDate
    const lateSigned = !met && Boolean(row.signDate)
    const wbNo = row.waybillNo ?? ''
    const courierCode = norm(row.courierCode)
    const isPriority = isPriorityRow(row, priorityClientCodes)

    for (const vendorCode of candidateVendorCodes) {
      if (!isRowInVendorScope(vendorCode, consigneeRouteCode, { routeCodesByVendor, routeCodeWhitelistByVendor })) continue

      let stat = result.get(vendorCode)
      if (!stat) {
        stat = { total: 0, met: 0, problemCount: 0, neverSignedCount: 0, lateSignedCount: 0, priorityTotal: 0, priorityUnsigned: 0, unmetNos: [], drivers: [], unassigned: null }
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
      if (isPriority) {
        stat.priorityTotal += 1
        // 本次派送已上报问题件视同已签收，与 24H 派签达标口径一致
        if (!row.signDate && !hasProblem) stat.priorityUnsigned += 1
      }

      accumulateDriverStat(
        driverMapByVendor,
        vendorCode,
        row,
        consigneeRouteCode,
        courierCode,
        met,
        hasProblem,
        neverSigned,
        lateSigned,
        isPriority,
        wbNo,
      )
    }
  }

  finalizeDriverStats(result, driverMapByVendor)
  return result
}

/** 结果 Map 的 key 用配置自己的 id（而非 vendorCode），使同一 vendorCode 的多条配置各自独立累计，互不覆盖 */
export type Dispatch24hScope = ConfigScope

/**
 * 按预先给定的多个独立范围一次遍历 rows 完成聚合，每个 scope 各自累计一份统计——
 * 供「同一批运单要按 N 个供应商推送配置（可能同 vendorCode 不同 routeCode 范围）分别出结果」的场景使用
 * （24H 派签逐配置推送），避免每个配置都重新扫一遍全量 rows。
 *
 * （24H 派签告警按推送配置 id 分桶，供应商日报按供应商单位 supplierKey 分桶）。
 *
 * 与 aggregateDispatch24hByVendor 的区别：后者按行动态发现 vendorCode，
 * 这里 vendorCode 由调用方在 scopes 里显式给定，不做动态发现。
 */
export function aggregateDispatch24hByScopes(input: {
  rows: Dispatch24hWaybillRow[]
  stationCodes: string[]
  rule: Dispatch24hWindowRule
  scopes: Dispatch24hScope[]
  /** 「优先客户配置」商家编码（大写）；缺省 = 不统计优先件 */
  priorityClientCodes?: Set<string>
}): Map<string, Dispatch24hVendorStat> {
  const { rows, stationCodes, rule, scopes, priorityClientCodes } = input
  const stationSet = new Set(stationCodes.map((s) => s.trim()).filter(Boolean))
  const inStation = (code: string | undefined) => stationSet.size === 0 || stationSet.has(norm(code))

  const result = new Map<string, Dispatch24hVendorStat>()
  const driverMapByKey = new Map<string, Map<string, Dispatch24hDriverStat>>()
  /** 同一 (vendorCode, routeCode) 的兜底只告警一次，避免整批同路由运单刷屏 */
  const foreignRouteWarned = new Set<string>()

  for (const row of rows) {
    if (!inStation(row.lastScanSiteCode)) continue
    const consigneeRouteCode = norm(row.consigneeRouteCode)
    const explicitVendorCode = norm(row.courierVendorCode)
    const met = isDispatch24hMet(row, rule)
    const hasProblem = isDispatch24hProblem(row)
    const neverSigned = !met && !row.signDate
    const lateSigned = !met && Boolean(row.signDate)
    const wbNo = row.waybillNo ?? ''
    const courierCode = norm(row.courierCode)
    const isPriority = isPriorityRow(row, priorityClientCodes)

    // 归属判定 + 路由被收窄时兜底落到承运商名下，唯一实现见 resolveConfigScopesForRow，不重抄。
    // ignoreWhitelist: false —— 本告警按 isRowInConfigScope 口径剔除白名单路由（excludeWhitelist
    // 开关由上游 scopes 是否带 routeCodeWhitelist 决定，这里不用关心）
    const matches = resolveConfigScopesForRow(scopes, explicitVendorCode, consigneeRouteCode, {
      ignoreWhitelist: false,
    })
    for (const { scope, isForeignRoute } of matches) {
      if (isForeignRoute) {
        const warnKey = `${explicitVendorCode}\t${consigneeRouteCode}`
        if (!foreignRouteWarned.has(warnKey)) {
          foreignRouteWarned.add(warnKey)
          console.warn(
            `[24H派签告警] 供应商 ${explicitVendorCode} 的路由 ${consigneeRouteCode} 未配置在任何子单元名单内，已兜底计入 ${scope.key}`,
          )
        }
      }

      let stat = result.get(scope.key)
      if (!stat) {
        stat = { total: 0, met: 0, problemCount: 0, neverSignedCount: 0, lateSignedCount: 0, priorityTotal: 0, priorityUnsigned: 0, unmetNos: [], drivers: [], unassigned: null }
        result.set(scope.key, stat)
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
      if (isPriority) {
        stat.priorityTotal += 1
        // 本次派送已上报问题件视同已签收，与 24H 派签达标口径一致
        if (!row.signDate && !hasProblem) stat.priorityUnsigned += 1
      }

      accumulateDriverStat(
        driverMapByKey,
        scope.key,
        row,
        consigneeRouteCode,
        courierCode,
        met,
        hasProblem,
        neverSigned,
        lateSigned,
        isPriority,
        wbNo,
      )
    }
  }

  finalizeDriverStats(result, driverMapByKey)
  return result
}
