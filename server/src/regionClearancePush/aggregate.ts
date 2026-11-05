/**
 * 区域大盘清货数据推送：大区整体 + 选中站点子维度的聚合统计。
 * 站点归属完全靠配置里手动勾选的 stationCodes 匹配 hubCode/ocCode/deliveryStationCode，不做大区归属校验。
 */
import { isRecord } from '../imile/shared'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export type DispatchDeliveredStat = {
  dispatchTotal: number
  deliveredTotal: number
  driverTotal: number
  byStation: Record<string, { dispatch: number; delivered: number; drivers: number }>
}

/** 派件统计：ofdRows 按 waybillNo 去重计数；签收统计：deliveredRows 按 waybillNo 去重计数；司机数：deliveredRows 按 driverCode 去重计数 */
export function aggregateDispatchDelivered(input: {
  ofdRows: unknown[]
  deliveredRows: unknown[]
  stationCodes: string[]
}): DispatchDeliveredStat {
  const stationSet = new Set(input.stationCodes)
  const byStation: Record<string, { dispatch: number; delivered: number; drivers: number }> = {}
  for (const code of stationSet) byStation[code] = { dispatch: 0, delivered: 0, drivers: 0 }

  const dispatchNos = new Set<string>()
  for (const row of input.ofdRows) {
    if (!isRecord(row)) continue
    const waybillNo = str(row.waybillNo)
    if (!waybillNo || dispatchNos.has(waybillNo)) continue
    dispatchNos.add(waybillNo)
    const hubCode = str(row.hubCode)
    if (stationSet.has(hubCode)) byStation[hubCode].dispatch += 1
  }

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
      if (stationSet.has(hubCode)) byStation[hubCode].delivered += 1
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
    byStation,
  }
}

export type InventoryStat = {
  inWarehouseTotal: number
  outWarehouseTotal: number
  total: number
  byStation: Record<string, { inWarehouse: number; outWarehouse: number; total: number }>
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
}): InventoryStat {
  const stationSet = new Set(input.stationCodes)
  const byStation: Record<string, { inWarehouse: number; outWarehouse: number; total: number }> = {}
  for (const code of stationSet) byStation[code] = { inWarehouse: 0, outWarehouse: 0, total: 0 }

  let inWarehouseTotal = 0
  for (const row of input.pendingRows) {
    if (!isRecord(row)) continue
    const inboundDate = str(row.inboundDate).slice(0, 10)
    if (inboundDate === input.todayDateStr) continue // 今天才入库的不算
    inWarehouseTotal += 1
    const ocCode = str(row.ocCode)
    if (stationSet.has(ocCode)) {
      byStation[ocCode].inWarehouse += 1
      byStation[ocCode].total += 1
    }
  }

  let outWarehouseTotal = 0
  for (const row of input.outboundRows) {
    if (!isRecord(row)) continue
    outWarehouseTotal += 1
    const deliveryStationCode = str(row.deliveryStationCode)
    if (stationSet.has(deliveryStationCode)) {
      byStation[deliveryStationCode].outWarehouse += 1
      byStation[deliveryStationCode].total += 1
    }
  }

  return {
    inWarehouseTotal,
    outWarehouseTotal,
    total: inWarehouseTotal + outWarehouseTotal,
    byStation,
  }
}
