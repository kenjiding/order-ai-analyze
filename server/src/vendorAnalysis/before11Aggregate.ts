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
  resolveVendorCodesByRouteCode,
  type VendorScopeMaps,
} from './supplierScope'

export type Before11TaggedRow = {
  waybillNo: string
  courierCode: string
  courierVendorCode: string
  courier: string
  consigneeRouteCode: string
  before11Exit: boolean
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
): Record<string, { pending: number; total: number }> {
  const zoneBreakdown: Record<string, { pending: number; total: number }> = {}
  for (const row of rows) {
    const zone = row.consigneeRouteCode.trim() || 'Unknown route'
    if (!zoneBreakdown[zone]) zoneBreakdown[zone] = { pending: 0, total: 0 }
    zoneBreakdown[zone].total++
    if (!row.before11Exit) zoneBreakdown[zone].pending++
  }
  return zoneBreakdown
}

export type Before11Scope = {
  /** 结果 Map 的 key，用配置自己的 id（而非 vendorCode），使同一 vendorCode 的多条配置各自独立累计，互不覆盖 */
  key: string
  vendorCode: string
  /** 路由码纳入名单；undefined = 不按路由码收窄 */
  routeCodes?: Set<string>
  routeCodeWhitelist?: Set<string>
}

export type Before11ScopedStat = {
  totalWaybills: number
  zoneBreakdown: Record<string, { pending: number; total: number }>
  /** 未在 11 点前出仓的运单号，供前端导出 Excel */
  unqualifiedWaybillNos: string[]
  /** 路由码白名单命中的行的统计（与主统计对称），供「路由码白名单数据推送」开关消费；始终计算，不受开关影响 */
  whitelistStat?: {
    totalWaybills: number
    zoneBreakdown: Record<string, { pending: number; total: number }>
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
}): Map<string, Before11ScopedStat> {
  const { rows, scopes } = input
  const result = new Map<string, Before11ScopedStat>()

  for (const row of rows) {
    const explicitVendorCode = row.courierVendorCode
    const routeCode = row.consigneeRouteCode

    for (const scope of scopes) {
      if (explicitVendorCode) {
        if (explicitVendorCode !== scope.vendorCode) continue
      } else if (!scope.routeCodes?.has(routeCode)) {
        continue
      }
      if (scope.routeCodes && !scope.routeCodes.has(routeCode)) continue

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
        if (!whitelistStat.zoneBreakdown[whitelistZone]) whitelistStat.zoneBreakdown[whitelistZone] = { pending: 0, total: 0 }
        whitelistStat.zoneBreakdown[whitelistZone].total += 1
        if (!row.before11Exit) {
          whitelistStat.zoneBreakdown[whitelistZone].pending += 1
          if (row.waybillNo) whitelistStat.unqualifiedWaybillNos.push(row.waybillNo)
        }
        continue
      }

      stat.totalWaybills += 1
      const zone = routeCode.trim() || 'Unknown route'
      if (!stat.zoneBreakdown[zone]) stat.zoneBreakdown[zone] = { pending: 0, total: 0 }
      stat.zoneBreakdown[zone].total += 1
      if (!row.before11Exit) {
        stat.zoneBreakdown[zone].pending += 1
        if (row.waybillNo) stat.unqualifiedWaybillNos.push(row.waybillNo)
      }
    }
  }

  return result
}
