/**
 * 区域大盘清货数据推送：大区整体 + 选中站点子维度的聚合统计。
 * 站点归属完全靠配置里手动勾选的 stationCodes 匹配 hubCode/ocCode/deliveryStationCode，不做大区归属校验。
 */
import { isRecord } from '../imile/shared'
import { isSheinClientCode, isTemuClientCode } from '../../../shared/clientCode/platformClientCodes'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 按商家 clientCode 分出的 Temu/Shein/本地件/其他件数。本地件 = 命中「优先客户配置」clientCode 集合，与 chaseDispatchAggregate.ts 的 isPriorityClient 同一口径 */
export type BrandCount = { temu: number; shein: number; local: number; other: number }
const emptyBrandCount = (): BrandCount => ({ temu: 0, shein: 0, local: 0, other: 0 })
function brandOf(clientCode: string, priorityClientCodes: Set<string>): keyof BrandCount {
  if (isTemuClientCode(clientCode)) return 'temu'
  if (isSheinClientCode(clientCode)) return 'shein'
  if (clientCode && priorityClientCodes.has(clientCode.trim().toUpperCase())) return 'local'
  return 'other'
}

export type DispatchDeliveredStat = {
  dispatchTotal: number
  deliveredTotal: number
  driverTotal: number
  dispatchBrand: BrandCount
  deliveredBrand: BrandCount
  byStation: Record<
    string,
    { dispatch: number; delivered: number; drivers: number; dispatchBrand: BrandCount; deliveredBrand: BrandCount }
  >
}

/** 派件统计：ofdRows 按 waybillNo 去重计数；签收统计：deliveredRows 按 waybillNo 去重计数；司机数：deliveredRows 按 driverCode 去重计数 */
export function aggregateDispatchDelivered(input: {
  ofdRows: unknown[]
  deliveredRows: unknown[]
  stationCodes: string[]
  priorityClientCodes: Set<string>
}): DispatchDeliveredStat {
  const stationSet = new Set(input.stationCodes)
  const byStation: DispatchDeliveredStat['byStation'] = {}
  for (const code of stationSet)
    byStation[code] = { dispatch: 0, delivered: 0, drivers: 0, dispatchBrand: emptyBrandCount(), deliveredBrand: emptyBrandCount() }

  const dispatchBrand = emptyBrandCount()
  const dispatchNos = new Set<string>()
  for (const row of input.ofdRows) {
    if (!isRecord(row)) continue
    const waybillNo = str(row.waybillNo)
    if (!waybillNo || dispatchNos.has(waybillNo)) continue
    dispatchNos.add(waybillNo)
    const brand = brandOf(str(row.clientCode), input.priorityClientCodes)
    dispatchBrand[brand] += 1
    const hubCode = str(row.hubCode)
    if (stationSet.has(hubCode)) {
      byStation[hubCode].dispatch += 1
      byStation[hubCode].dispatchBrand[brand] += 1
    }
  }

  const deliveredBrand = emptyBrandCount()
  const deliveredNos = new Set<string>()
  const driverCodesTotal = new Set<string>()
  const driverCodesByStation: Record<string, Set<string>> = {}
  for (const row of input.deliveredRows) {
    if (!isRecord(row)) continue
    const waybillNo = str(row.waybillNo)
    const driverCode = str(row.driverCode)
    const hubCode = str(row.hubCode)

    if (waybillNo && !deliveredNos.has(waybillNo)) {
      deliveredNos.add(waybillNo)
      const brand = brandOf(str(row.clientCode), input.priorityClientCodes)
      deliveredBrand[brand] += 1
      if (stationSet.has(hubCode)) {
        byStation[hubCode].delivered += 1
        byStation[hubCode].deliveredBrand[brand] += 1
      }
    }
    if (driverCode) {
      driverCodesTotal.add(driverCode)
      if (stationSet.has(hubCode)) {
        const set = driverCodesByStation[hubCode] ?? new Set<string>()
        set.add(driverCode)
        driverCodesByStation[hubCode] = set
      }
    }
  }
  for (const [code, set] of Object.entries(driverCodesByStation)) {
    byStation[code].drivers = set.size
  }

  return {
    dispatchTotal: dispatchNos.size,
    deliveredTotal: deliveredNos.size,
    driverTotal: driverCodesTotal.size,
    dispatchBrand,
    deliveredBrand,
    byStation,
  }
}

export type InventoryStat = {
  inWarehouseTotal: number
  outWarehouseTotal: number
  total: number
  inWarehouseBrand: BrandCount
  outWarehouseBrand: BrandCount
  byStation: Record<
    string,
    { inWarehouse: number; outWarehouse: number; total: number; inWarehouseBrand: BrandCount; outWarehouseBrand: BrandCount }
  >
}

/**
 * 今日库存：仓内（pending/delivery/query，剔除今天入库的）+ 仓外（daWaybillInventory）。
 * 仓内按 ocCode 匹配站点，仓外按 deliveryStationCode 匹配站点。
 */
export function aggregateInventory(input: {
  pendingRows: unknown[]
  outboundRows: unknown[]
  stationCodes: string[]
  todayDateStr: string
  priorityClientCodes: Set<string>
}): InventoryStat {
  const stationSet = new Set(input.stationCodes)
  const byStation: InventoryStat['byStation'] = {}
  for (const code of stationSet)
    byStation[code] = { inWarehouse: 0, outWarehouse: 0, total: 0, inWarehouseBrand: emptyBrandCount(), outWarehouseBrand: emptyBrandCount() }

  let inWarehouseTotal = 0
  const inWarehouseBrand = emptyBrandCount()
  for (const row of input.pendingRows) {
    if (!isRecord(row)) continue
    const inboundDate = str(row.inboundDate).slice(0, 10)
    if (inboundDate === input.todayDateStr) continue // 今天才入库的不算
    inWarehouseTotal += 1
    const brand = brandOf(str(row.clientCode), input.priorityClientCodes)
    inWarehouseBrand[brand] += 1
    const ocCode = str(row.ocCode)
    if (stationSet.has(ocCode)) {
      byStation[ocCode].inWarehouse += 1
      byStation[ocCode].total += 1
      byStation[ocCode].inWarehouseBrand[brand] += 1
    }
  }

  let outWarehouseTotal = 0
  const outWarehouseBrand = emptyBrandCount()
  for (const row of input.outboundRows) {
    if (!isRecord(row)) continue
    outWarehouseTotal += 1
    const brand = brandOf(str(row.clientCode), input.priorityClientCodes)
    outWarehouseBrand[brand] += 1
    const deliveryStationCode = str(row.deliveryStationCode)
    if (stationSet.has(deliveryStationCode)) {
      byStation[deliveryStationCode].outWarehouse += 1
      byStation[deliveryStationCode].total += 1
      byStation[deliveryStationCode].outWarehouseBrand[brand] += 1
    }
  }

  return {
    inWarehouseTotal,
    outWarehouseTotal,
    total: inWarehouseTotal + outWarehouseTotal,
    inWarehouseBrand,
    outWarehouseBrand,
    byStation,
  }
}

/**
 * 用一句话总结跟上次推送的趋势（库存清货进度 + 派件量），没有上次快照（首次推送）时返回 null。
 * 库存降=清货有进展，库存升=提醒关注，跟卡片里"涨红跌绿"的颜色逻辑一致。
 */
export function buildTrendSummary(
  todayStat: DispatchDeliveredStat,
  inventoryStat: InventoryStat,
  prevTodayStat: DispatchDeliveredStat | null | undefined,
  prevInventoryStat: InventoryStat | null | undefined,
): string | null {
  if (!prevTodayStat || !prevInventoryStat) return null

  const invDelta = inventoryStat.total - prevInventoryStat.total
  const invText =
    invDelta < 0
      ? `库存减少${Math.abs(invDelta)}件，清货进度良好`
      : invDelta > 0
        ? `库存增加${invDelta}件，建议关注清货进度`
        : '库存与上次持平'

  const dispatchDelta = todayStat.dispatchTotal - prevTodayStat.dispatchTotal
  const dispatchText =
    dispatchDelta > 0
      ? `派件量上升${dispatchDelta}单`
      : dispatchDelta < 0
        ? `派件量下降${Math.abs(dispatchDelta)}单`
        : '派件量持平'

  return `较上次推送：${invText}；${dispatchText}。`
}
