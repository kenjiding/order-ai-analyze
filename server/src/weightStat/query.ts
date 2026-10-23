/**
 * 包裹重量统计：按到件日走 inbound 索引（命中 DB 缓存则复用，未命中现场拉取并写回），
 * 拿到运单号后批量查 Janus（ausops/waybillInfo/query）取可信重量，供前端自定义区间统计与分布可视化。
 *
 * 供应商归属复用 vendorAnalysis/supplierScope 这一唯一权威，不自己重抄过滤条件（见该文件头注释）。
 * Janus 的 dispatch_vendor_code 实测几乎全空（抽样 351 单仅 1 单有值），所以这里总是落到
 * isRowInConfigScopeIgnoringWhitelist 里「承运商未回填、按路由码兜底归属」的分支——这正是该模块
 * 为「未派件」场景设计的兜底路径，不是一次特例写法。用 ignoringWhitelist 而不是 resolve：
 * 这是描述性统计，要看到全部件数，不应该因为白名单配置而悄悄丢单。
 */
import { getOrFetchInboundWaybillNos } from '../imile/inboundWaybillIndex'
import { fetchJanusAusWaybills, resolveTrustedWeight } from '../imile/janusClient'
import { enumerateDatesInclusive } from '../exitRateQuery/aggregate'
import { listSupplierPushConfigs } from '../supplierPushConfigs'
import { buildSupplierUnitIndex } from '../vendorAnalysis/supplierScope'

export type WeightStatItem = {
  waybillNo: string
  weight: number | null
  routeCode: string
  supplierKey: string
  supplierName: string
}

export type WeightStatQueryResult = {
  stationCode: string
  startDate: string
  endDate: string
  dates: string[]
  items: WeightStatItem[]
}

export type WeightStatQueryError = {
  ok: false
  status: number
  message: string
}

export async function queryWeightStat(input: {
  token: string
  stationCode: string
  startDate: string
  endDate: string
  regionCode?: string | null
}): Promise<{ ok: true; data: WeightStatQueryResult } | WeightStatQueryError> {
  const dates = enumerateDatesInclusive(input.startDate, input.endDate)
  const waybillNoSet = new Set<string>()

  for (const dateStr of dates) {
    const indexed = await getOrFetchInboundWaybillNos({
      token: input.token,
      stationCode: input.stationCode,
      dateStr,
      label: '重量统计 到件索引',
    })
    if (!indexed.ok) return { ok: false, status: indexed.status ?? 502, message: indexed.message }
    for (const no of indexed.waybillNos) waybillNoSet.add(no)
  }

  const waybillNos = [...waybillNoSet]
  const janus = await fetchJanusAusWaybills(input.token, waybillNos, '重量统计')
  if (!janus.ok) return { ok: false, status: janus.status, message: janus.message }

  const configs = await listSupplierPushConfigs(input.regionCode ?? undefined)
  const supplierIndex = buildSupplierUnitIndex(configs)

  const items: WeightStatItem[] = waybillNos.map((waybillNo) => {
    const row = janus.data.get(waybillNo) ?? { waybill_no: waybillNo }
    const routeCode = row.consignee_route_code?.trim() ?? ''
    const supplierKeys = supplierIndex.resolveIgnoringWhitelist(row.dispatch_vendor_code, routeCode)
    const unit = supplierKeys.length > 0 ? supplierIndex.units.get(supplierKeys[0]) : undefined
    return {
      waybillNo,
      weight: resolveTrustedWeight(row),
      routeCode,
      supplierKey: unit?.supplierKey ?? '',
      supplierName: unit?.supplierName ?? '',
    }
  })

  return {
    ok: true,
    data: { stationCode: input.stationCode, startDate: input.startDate, endDate: input.endDate, dates, items },
  }
}
