/**
 * 11点前出仓 —— 打标与投影。
 *
 * 分层约定：
 * - tagBefore11Rows：只按 deliveryTime 打 before11Exit，不做供应商范围过滤（取数层用）。
 * - filterBefore11RowsByScope：业务方按纳入/白名单（及可选 vendorCode）收窄（分析 / 告警用）。
 * 「供应商数据分析」出仓率与「11点前出仓告警」分区未出仓件数都是同一套打标行的投影，
 * 过滤口径统一走 supplierScope。
 */
import { isBefore11Exit } from '../imile/before11Exit'
import {
  buildRouteCodeVendorsMap,
  isRowInVendorScope,
  normCode,
  resolveConfigScopesForRow,
  resolveConfigScopesForRowByRoutePriority,
  resolveVendorCodesByRouteCode,
  type ConfigScope,
  type VendorScopeMaps,
} from './supplierScope'

export type Before11TaggedRow = {
  waybillNo: string
  courierCode: string
  courierVendorCode: string
  courier: string
  consigneeRouteCode: string
  /** 商家编码；与「优先客户配置」比对得出是否「本地件优先客户」包裹 */
  clientCode: string
  before11Exit: boolean
}

/**
 * 分区统计：pending 未出仓件数，total 总件数，
 * priority「本地件优先客户」件数，priorityExited 其中已在阈值前出仓的件数。
 */
export type Before11ZoneStats = {
  pending: number
  total: number
  priority: number
  priorityExited: number
}

/** 该单是否属于「本地件优先客户」：clientCode 命中「优先客户配置」的商家编码（大写比较） */
function isPriorityRow(row: Before11TaggedRow, priorityClientCodes?: Set<string>): boolean {
  if (!priorityClientCodes || priorityClientCodes.size === 0) return false
  return priorityClientCodes.has(row.clientCode.toUpperCase())
}

export type Before11RateResult = {
  before11ExitRate: number
  before11ExitVolume: number
  totalReceived: number
}

/** 纯打标：全量行按阈值贴 before11Exit，不做范围过滤 */
export function tagBefore11Rows(input: {
  rows: Array<Record<string, unknown>>
  before11ThresholdMs: number
}): Before11TaggedRow[] {
  const tagged: Before11TaggedRow[] = []
  for (const row of input.rows) {
    const deliveryTime =
      typeof row.deliveryTime === 'string' && row.deliveryTime ? row.deliveryTime : null
    tagged.push({
      waybillNo: typeof row.waybillNo === 'string' ? row.waybillNo : '',
      courierCode: typeof row.courierCode === 'string' ? row.courierCode : '',
      courierVendorCode: normCode(row.courierVendorCode),
      courier: typeof row.courier === 'string' ? row.courier : '',
      consigneeRouteCode: typeof row.consigneeRouteCode === 'string' ? row.consigneeRouteCode : '',
      clientCode: typeof row.clientCode === 'string' ? row.clientCode.trim() : '',
      before11Exit: isBefore11Exit(deliveryTime, input.before11ThresholdMs),
    })
  }
  return tagged
}

/**
 * 业务层过滤：courierVendorCode 有值 → 按它归属（唯一）；为空（尚未派件）→ 按 consigneeRouteCode
 * 匹配所有配置了该路由码的供应商，各自独立命中、独立统计（两家供应商共担同一路由码是正常业务场景，
 * 见 buildRouteCodeVendorsMap），再各自套用纳入收窄 + 白名单剔除；scope 无该供应商时整行保留。
 * 传 vendorCode 时只保留该供应商（告警按配置逐条推送）。
 * 尚未派件的单 deliveryTime 为空，isBefore11Exit 已天然判定为未达标，本函数不再额外剔除，
 * 一并计入该供应商的 total / pending——理由与 24H 派签一致：没派件就必然没在 11 点前出仓。
 * 一行可能因路由码被多个供应商配置而命中多个供应商——此时返回多条副本（courierVendorCode 各自改写），
 * 供调用方（projectBefore11RatesByVendor 等）按各自的 courierVendorCode 分组统计。
 */
export function filterBefore11RowsByScope(
  rows: Before11TaggedRow[],
  scope: VendorScopeMaps,
  vendorCode?: string,
): Before11TaggedRow[] {
  const targetVendor = normCode(vendorCode)
  const routeCodeVendorsMap = buildRouteCodeVendorsMap(scope.routeCodesByVendor)
  const result: Before11TaggedRow[] = []
  for (const row of rows) {
    const candidateVendors = row.courierVendorCode
      ? [row.courierVendorCode]
      : resolveVendorCodesByRouteCode(row.consigneeRouteCode, routeCodeVendorsMap)
    for (const candidate of candidateVendors) {
      if (targetVendor && candidate !== targetVendor) continue
      if (!isRowInVendorScope(candidate, row.consigneeRouteCode, scope)) continue
      result.push(candidate === row.courierVendorCode ? row : { ...row, courierVendorCode: candidate })
    }
  }
  return result
}

/** 分析投影：按供应商统计出仓率（仅统计 vendorCodes 中列出的供应商） */
export function projectBefore11RatesByVendor(
  rows: Before11TaggedRow[],
  vendorCodes: string[],
): Record<string, Before11RateResult> {
  const vendorSet = new Set(vendorCodes.map(normCode).filter(Boolean))
  const stats = new Map<string, { before11: number; total: number }>()
  for (const row of rows) {
    if (!vendorSet.has(row.courierVendorCode)) continue
    let s = stats.get(row.courierVendorCode)
    if (!s) {
      s = { before11: 0, total: 0 }
      stats.set(row.courierVendorCode, s)
    }
    s.total += 1
    if (row.before11Exit) s.before11 += 1
  }

  const ratesByVendor: Record<string, Before11RateResult> = {}
  for (const [vendorCode, s] of stats.entries()) {
    ratesByVendor[vendorCode] = {
      before11ExitRate: s.total > 0 ? s.before11 / s.total : 0,
      before11ExitVolume: s.before11,
      totalReceived: s.total,
    }
  }
  return ratesByVendor
}

/** 告警卡片投影：按 routeCode 分区统计未出仓件数（pending = 未在 11 点前出仓） */
export function projectBefore11ZoneBreakdown(
  rows: Before11TaggedRow[],
  priorityClientCodes?: Set<string>,
): Record<string, Before11ZoneStats> {
  const zoneBreakdown: Record<string, Before11ZoneStats> = {}
  for (const row of rows) {
    const zone = row.consigneeRouteCode.trim() || 'Unknown route'
    if (!zoneBreakdown[zone]) zoneBreakdown[zone] = { pending: 0, total: 0, priority: 0, priorityExited: 0 }
    zoneBreakdown[zone].total++
    if (!row.before11Exit) zoneBreakdown[zone].pending++
    if (isPriorityRow(row, priorityClientCodes)) {
      zoneBreakdown[zone].priority++
      if (row.before11Exit) zoneBreakdown[zone].priorityExited++
    }
  }
  return zoneBreakdown
}

/**
 * 结果 Map 的 key 由调用方决定含义：告警按推送配置 id 分桶，供应商日报按供应商单位 supplierKey 分桶。
 * 两者都是「同一 vendorCode 的多个范围各自独立累计，互不覆盖」。
 */
export type Before11Scope = ConfigScope

export type Before11ScopedStat = {
  totalWaybills: number
  zoneBreakdown: Record<string, Before11ZoneStats>
  /** 未在 11 点前出仓的运单号，供前端导出 Excel */
  unqualifiedWaybillNos: string[]
  /** 路由码白名单命中的行的统计（与主统计对称），供「路由码白名单数据推送」开关消费；始终计算，不受开关影响 */
  whitelistStat?: {
    totalWaybills: number
    zoneBreakdown: Record<string, Before11ZoneStats>
    /** 白名单范围内未在阈值前出仓的运单号，供前端导出 Excel（与主统计 unqualifiedWaybillNos 对称） */
    unqualifiedWaybillNos: string[]
  }
}

/**
 * 按预先给定的多个独立范围一次遍历 rows，完成过滤 + 分区统计 + 未达标运单号收集，每个 scope 各自出一份结果——
 * 供「同一批到件运单要按 N 个供应商推送配置分别出结果」的场景使用（11点前出仓告警逐配置推送），
 * 避免每个配置都对全量 rows 重新过滤一遍（等价于 filterBefore11RowsByScope + projectBefore11ZoneBreakdown
 * 按 vendorCode 逐个调用，但只扫一遍 rows）。
 *
 * 与 filterBefore11RowsByScope 的区别：后者按行动态发现 vendorCode（「供应商数据分析」要看全量供应商口径），
 * 这里 vendorCode 由调用方在 scopes 里显式给定，不做动态发现。
 */
export function aggregateBefore11ByScopes(input: {
  rows: Before11TaggedRow[]
  scopes: Before11Scope[]
  /** 「优先客户配置」商家编码（大写）；缺省 = 不统计优先件 */
  priorityClientCodes?: Set<string>
  /**
   * 路由归属优先于承运商归属：代清货/借调司机跑了这条路由，也算到路由配置所属的供应商头上。
   * 仅供「滞留数据告警」传 true；其余调用方（如「供应商数据分析」出仓率）不传，保持原口径
   * （courierVendorCode 精确匹配优先），因为那些场景要看的是实际承运商，不是路由名义归属。
   * 见 supplierScope.resolveConfigScopesForRowByRoutePriority 的使用边界说明。
   */
  routePriority?: boolean
}): Map<string, Before11ScopedStat> {
  const { rows, scopes, priorityClientCodes, routePriority } = input
  const result = new Map<string, Before11ScopedStat>()
  /** 同一 (vendorCode, routeCode) 的兜底只告警一次，避免整批同路由运单刷屏 */
  const foreignRouteWarned = new Set<string>()

  for (const row of rows) {
    const explicitVendorCode = row.courierVendorCode
    const routeCode = row.consigneeRouteCode
    const isPriority = isPriorityRow(row, priorityClientCodes)

    // 白名单命中的行下面要单独计入 whitelistStat，故这里用不含白名单剔除的判定；
    // 归属判定 + 路由被收窄时兜底落到承运商名下，唯一实现见 resolveConfigScopesForRow，不重抄
    const matches = routePriority
      ? resolveConfigScopesForRowByRoutePriority(scopes, explicitVendorCode, routeCode, {
          ignoreWhitelist: true,
        }).map((scope) => ({ scope, isForeignRoute: false }))
      : resolveConfigScopesForRow(scopes, explicitVendorCode, routeCode, { ignoreWhitelist: true })
    for (const { scope, isForeignRoute } of matches) {
      if (isForeignRoute) {
        const warnKey = `${explicitVendorCode}\t${routeCode}`
        if (!foreignRouteWarned.has(warnKey)) {
          foreignRouteWarned.add(warnKey)
          console.warn(
            `[滞留数据告警] 供应商 ${explicitVendorCode} 的路由 ${routeCode} 未配置在任何子单元名单内，已兜底计入 ${scope.key}`,
          )
        }
      }

      let stat = result.get(scope.key)
      if (!stat) {
        stat = { totalWaybills: 0, zoneBreakdown: {}, unqualifiedWaybillNos: [] }
        result.set(scope.key, stat)
      }

      if (scope.routeCodeWhitelist?.has(routeCode)) {
        if (!stat.whitelistStat) {
          stat.whitelistStat = { totalWaybills: 0, zoneBreakdown: {}, unqualifiedWaybillNos: [] }
        }
        const whitelistStat = stat.whitelistStat
        whitelistStat.totalWaybills += 1
        const whitelistZone = routeCode.trim() || 'Unknown route'
        if (!whitelistStat.zoneBreakdown[whitelistZone]) whitelistStat.zoneBreakdown[whitelistZone] = { pending: 0, total: 0, priority: 0, priorityExited: 0 }
        whitelistStat.zoneBreakdown[whitelistZone].total += 1
        if (isPriority) {
          whitelistStat.zoneBreakdown[whitelistZone].priority += 1
          if (row.before11Exit) whitelistStat.zoneBreakdown[whitelistZone].priorityExited += 1
        }
        if (!row.before11Exit) {
          whitelistStat.zoneBreakdown[whitelistZone].pending += 1
          if (row.waybillNo) whitelistStat.unqualifiedWaybillNos.push(row.waybillNo)
        }
        continue
      }

      stat.totalWaybills += 1
      const zone = routeCode.trim() || 'Unknown route'
      if (!stat.zoneBreakdown[zone]) stat.zoneBreakdown[zone] = { pending: 0, total: 0, priority: 0, priorityExited: 0 }
      stat.zoneBreakdown[zone].total += 1
      if (isPriority) {
        stat.zoneBreakdown[zone].priority += 1
        if (row.before11Exit) stat.zoneBreakdown[zone].priorityExited += 1
      }
      if (!row.before11Exit) {
        stat.zoneBreakdown[zone].pending += 1
        if (row.waybillNo) stat.unqualifiedWaybillNos.push(row.waybillNo)
      }
    }
  }

  return result
}
