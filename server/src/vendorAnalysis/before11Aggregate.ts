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
 * 业务层过滤：按 courierVendorCode 归属套用纳入收窄 + 白名单剔除；
 * scope 无该供应商时整行保留。传 vendorCode 时只保留该供应商（告警按配置逐条推送）。
 */
export function filterBefore11RowsByScope(
  rows: Before11TaggedRow[],
  scope: VendorScopeMaps,
  vendorCode?: string,
): Before11TaggedRow[] {
  const targetVendor = normCode(vendorCode)
  return rows.filter((row) => {
    if (targetVendor && row.courierVendorCode !== targetVendor) return false
    return isRowInVendorScope(row.courierVendorCode, row.consigneeRouteCode, scope)
  })
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
