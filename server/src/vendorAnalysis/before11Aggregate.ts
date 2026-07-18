/**
 * 11点前出仓 —— 过滤 + 打标核心。
 *
 * 「供应商数据分析」的出仓率与「11点前出仓告警」的分区未出仓件数都是本文件
 * tagBefore11Rows 产出行集的投影：两边永远基于同一集合，数学上不可能对不上。
 * 供应商归属统一走 supplierScope（courierVendorCode 归属 → routeCode 纳入 → 白名单剔除）。
 */
import { isBefore11Exit } from '../imile/before11Exit'
import { isRowInVendorScope, normCode, type VendorScopeMaps } from './supplierScope'

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

/**
 * 过滤 + 打标：每行按自身 courierVendorCode 归属，套用该供应商的范围（纳入收窄 + 白名单剔除）；
 * scope 无该供应商时整行保留（未配置供应商不收窄）。
 * 传 vendorCode 时只保留该供应商的运单（告警按配置逐条推送用）。
 */
export function tagBefore11Rows(input: {
  rows: Array<Record<string, unknown>>
  before11ThresholdMs: number
  scope: VendorScopeMaps
  vendorCode?: string
}): Before11TaggedRow[] {
  const targetVendor = normCode(input.vendorCode)
  const tagged: Before11TaggedRow[] = []

  for (const row of input.rows) {
    const courierVendorCode = normCode(row.courierVendorCode)
    if (targetVendor && courierVendorCode !== targetVendor) continue
    const consigneeRouteCode = typeof row.consigneeRouteCode === 'string' ? row.consigneeRouteCode : ''
    if (!isRowInVendorScope(courierVendorCode, consigneeRouteCode, input.scope)) continue

    const deliveryTime =
      typeof row.deliveryTime === 'string' && row.deliveryTime ? row.deliveryTime : null
    tagged.push({
      waybillNo: typeof row.waybillNo === 'string' ? row.waybillNo : '',
      courierCode: typeof row.courierCode === 'string' ? row.courierCode : '',
      courierVendorCode,
      courier: typeof row.courier === 'string' ? row.courier : '',
      consigneeRouteCode,
      before11Exit: isBefore11Exit(deliveryTime, input.before11ThresholdMs),
    })
  }
  return tagged
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
