/**
 * 「11点前出仓率 × 24小时派签率」的交叉聚合。
 *
 * 两个指标共用同一批单（站点在到件日 D 的全部运单），因此分母完全相同，可以直接交叉。
 * 输出粒度是最细的格子：供应商单位 × 路由码 × 司机。路由码层与供应商层不落库，
 * 查询时按格子 SUM 得到——避免同一份数据存三份、还要维护三份一致性。
 *
 * 判定全部复用既有原语，不在这里另写一套口径：
 * - 归属：supplierScope 的 isRowInConfigScope（vendorCode 归属 → routeCode 纳入 → 白名单剔除）
 * - 派签：dispatch24hAggregate 的 isDispatch24hMet / isDispatch24hProblem
 * - 出仓：imile/before11Exit 的 isBefore11Exit
 */
import { isBefore11Exit } from '../imile/before11Exit'
import {
  isDispatch24hMet,
  isDispatch24hProblem,
  type Dispatch24hScope,
  type Dispatch24hWaybillRow,
  type Dispatch24hWindowRule,
} from '../vendorAnalysis/dispatch24hAggregate'
import { isRowInConfigScope } from '../vendorAnalysis/supplierScope'

/** 未派件的单没有司机可归，用空串占位，使司机行加总仍等于供应商总数 */
export const NO_COURIER_CODE = ''
/** 没有路由码的单同样用空串占位，不混进任何真实路由码 */
export const NO_ROUTE_CODE = ''

/** 格子主键分隔符：路由码/司机码都不含制表符，不会与内容冲突 */
const CELL_KEY_SEP = '\t'

export type DispatchPerformanceCell = {
  /** scope 的 key，本模块调用方传的是 supplierKey */
  scopeKey: string
  routeCode: string
  courierCode: string
  courierName: string
  total: number
  /** 11点前出仓达标数。出仓那一趟就已确定，此时四象限还填不出来 */
  before11Met: number
  /** 派签是否已结算；false 时以下四象限与派签相关计数全为 0，不代表「都是 0」而是「还不知道」 */
  dispatchSettled: boolean
  /** 四象限，之和恒等于 total（仅 dispatchSettled 时有效） */
  exitMetSignMet: number
  exitMetSignUnmet: number
  exitUnmetSignMet: number
  exitUnmetSignUnmet: number
  /** 问题件数：见 isDispatch24hProblem 口径，与四象限正交（不参与加总） */
  problemCount: number
  /** 派签未达标中：完全没有签收记录 */
  neverSignedCount: number
  /** 派签未达标中：有签收记录但超过窗口才签收 */
  lateSignedCount: number
  neverSignedWaybillNos: string[]
  lateSignedWaybillNos: string[]
  problemWaybillNos: string[]
  before11UnmetWaybillNos: string[]
}

function norm(code: unknown): string {
  return typeof code === 'string' ? code.trim() : ''
}

function newCell(
  scopeKey: string,
  routeCode: string,
  courierCode: string,
  courierName: string,
): DispatchPerformanceCell {
  return {
    scopeKey,
    routeCode,
    courierCode,
    courierName,
    total: 0,
    before11Met: 0,
    dispatchSettled: false,
    exitMetSignMet: 0,
    exitMetSignUnmet: 0,
    exitUnmetSignMet: 0,
    exitUnmetSignUnmet: 0,
    problemCount: 0,
    neverSignedCount: 0,
    lateSignedCount: 0,
    neverSignedWaybillNos: [],
    lateSignedWaybillNos: [],
    problemWaybillNos: [],
    before11UnmetWaybillNos: [],
  }
}

/**
 * 一次遍历同时算出全部 scope 的格子。
 *
 * **两趟结算**：`rule` 为 null 表示只结算出仓那一趟（D+1）——此时派签窗口尚未到期，
 * 提前判定会把「还没派完」当成「派不完」，且包裹可能被归班盘点重新派出，结论会变。
 * 这一趟只填 total / before11Met / before11UnmetWaybillNos，四象限留空、dispatchSettled=false。
 * 传入 rule 即派签那一趟（D+2），完整填四象限并置 dispatchSettled=true。
 *
 * 与 aggregateDispatch24hByScopes 的关系：那个按 scope 出一份汇总 + 司机明细，供告警卡片用；
 * 这里出的是可落库的最细格子，多带一维路由码和出仓维度。两者共用同一套行级判定，结论必然一致。
 */
export function aggregateDispatchPerformanceCells(input: {
  rows: Dispatch24hWaybillRow[]
  stationCodes: string[]
  /** null = 只结算出仓那一趟；给定 rule = 连派签一起结算 */
  rule: Dispatch24hWindowRule | null
  /** 出仓阈值：到件日次日（出仓日）的 11:00，见 dispatchExitThresholdMs */
  before11ThresholdMs: number
  scopes: Dispatch24hScope[]
}): DispatchPerformanceCell[] {
  const { rows, stationCodes, rule, before11ThresholdMs, scopes } = input
  const dispatchSettled = rule != null
  const stationSet = new Set(stationCodes.map((s) => s.trim()).filter(Boolean))
  const inStation = (code: string | undefined) => stationSet.size === 0 || stationSet.has(norm(code))

  const cells = new Map<string, DispatchPerformanceCell>()

  for (const row of rows) {
    if (!inStation(row.lastScanSiteCode)) continue

    const routeCode = norm(row.consigneeRouteCode) || NO_ROUTE_CODE
    const explicitVendorCode = norm(row.courierVendorCode)
    const courierCode = norm(row.courierCode) || NO_COURIER_CODE
    const courierName = row.courier?.trim() || courierCode

    const exitMet = isBefore11Exit(row.deliveryTime, before11ThresholdMs)
    const signMet = rule != null && isDispatch24hMet(row, rule)
    const hasProblem = rule != null && isDispatch24hProblem(row)
    const neverSigned = rule != null && !signMet && !row.signDate
    const lateSigned = rule != null && !signMet && Boolean(row.signDate)
    const wbNo = row.waybillNo ?? ''

    for (const scope of scopes) {
      if (!isRowInConfigScope(scope, explicitVendorCode, routeCode)) continue

      const key = [scope.key, routeCode, courierCode].join(CELL_KEY_SEP)
      let cell = cells.get(key)
      if (!cell) {
        cell = newCell(scope.key, routeCode, courierCode, courierName)
        cells.set(key, cell)
      }

      cell.total += 1
      cell.dispatchSettled = dispatchSettled
      if (exitMet) cell.before11Met += 1

      // 四象限只在派签结算那一趟才有意义；出仓趟留全 0，由 dispatchSettled 标明「还不知道」
      if (dispatchSettled) {
        if (exitMet) {
          if (signMet) cell.exitMetSignMet += 1
          else cell.exitMetSignUnmet += 1
        } else if (signMet) {
          cell.exitUnmetSignMet += 1
        } else {
          cell.exitUnmetSignUnmet += 1
        }
      }

      if (hasProblem) {
        cell.problemCount += 1
        if (wbNo) cell.problemWaybillNos.push(wbNo)
      }
      if (neverSigned) {
        cell.neverSignedCount += 1
        if (wbNo) cell.neverSignedWaybillNos.push(wbNo)
      }
      if (lateSigned) {
        cell.lateSignedCount += 1
        if (wbNo) cell.lateSignedWaybillNos.push(wbNo)
      }
      if (!exitMet && wbNo) cell.before11UnmetWaybillNos.push(wbNo)
    }
  }

  return [...cells.values()]
}
