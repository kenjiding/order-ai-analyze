/**
 * 出仓派签达成分析底表导出：把供应商→路由→司机三层树拍平成单一宽表，
 * 一行 = 一个司机（叶子节点），供人工数据透视表或 AI 直接分析，不必自己重新聚合。
 * 率类字段与其分子分母（met/total）成对导出——它们不可加权平均，
 * 分析时如需按任意子集重新算率，只能靠原始计数自己求和，不能对 Rate 列取平均。
 */
import { saveAs } from 'file-saver'
import * as XLSX from 'xlsx'
import { showToast } from '../../utils/toast'
import type {
  DispatchDriverNode,
  DispatchMetrics,
  DispatchPerformanceResult,
  DispatchRouteNode,
  DispatchSupplierNode,
  WhitelistMode,
} from './dispatchPerformanceTypes'

type T = (key: string, options?: Record<string, unknown>) => string
type ExportRow = Record<string, string | number>

function timestamp(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14)
}

function driverDisplayName(driver: DispatchDriverNode | null, t: T): string {
  if (!driver) return ''
  return driver.courierCode ? driver.courierName : t('breakdown.unassignedDriver')
}

function baseDims(result: DispatchPerformanceResult, whitelistMode: WhitelistMode, t: T): ExportRow {
  return {
    [t('export.colStationCode')]: result.stationCode,
    [t('export.colStationName')]: result.config.stationName,
    [t('export.colStartDate')]: result.startDate,
    [t('export.colEndDate')]: result.endDate,
    [t('export.colWhitelistMode')]: t(
      whitelistMode === 'exclude' ? 'detail.whitelistModeExclude' : 'detail.whitelistModeInclude',
    ),
  }
}

function metricCells(m: DispatchMetrics, t: T): ExportRow {
  return {
    [t('export.colTotal')]: m.total,
    [t('export.colVendorProfit')]: Number(m.vendorProfit.toFixed(2)),
    [t('export.colCourierProfit')]: Number(m.courierProfit.toFixed(2)),
    [t('export.colBefore11Met')]: m.before11Met,
    [t('export.colBefore11Rate')]: m.before11Rate ?? '',
    [t('export.colSameDayExitMet')]: m.sameDayExitMet,
    [t('export.colSameDayExitRate')]: m.sameDayExitRate ?? '',
    [t('export.colSignMet')]: m.signMet,
    [t('export.colSignRate')]: m.signRate ?? '',
    [t('export.colNextDaySignMet')]: m.nextDaySignMet,
    [t('export.colNextDaySignRate')]: m.nextDaySignRate ?? '',
    [t('export.colPriorityTotal')]: m.priorityTotal,
    [t('export.colPriorityBefore11Met')]: m.priorityBefore11Met,
    [t('export.colPriorityNextDaySignMet')]: m.priorityNextDaySignMet,
    [t('export.colPriorityNextDaySignRate')]: m.priorityNextDaySignRate ?? '',
    [t('export.colProblemCount')]: m.problemCount,
    [t('export.colNeverSignedCount')]: m.neverSignedCount,
    [t('export.colLateSignedCount')]: m.lateSignedCount,
    [t('export.colPricedSignedCount')]: m.pricedSignedCount,
    [t('export.colUnpricedSignedCount')]: m.unpricedSignedCount,
  }
}

/**
 * 主表：一行一司机（叶子节点）。供应商没有路由、或路由没有司机时，
 * 补一行用该层自身的汇总值，避免这部分数据在导出里整体消失。
 */
export function toDispatchExportRows(
  result: DispatchPerformanceResult,
  whitelistMode: WhitelistMode,
  t: T,
): ExportRow[] {
  const base = baseDims(result, whitelistMode, t)
  const rows: ExportRow[] = []

  function pushRow(
    supplier: DispatchSupplierNode,
    route: DispatchRouteNode | null,
    driver: DispatchDriverNode | null,
    metrics: DispatchMetrics,
  ) {
    rows.push({
      ...base,
      [t('export.colSupplierName')]: supplier.supplierName,
      [t('export.colVendorCode')]: supplier.vendorCode,
      [t('export.colRouteCode')]: route?.routeCode ?? '',
      [t('export.colRouteWhitelistTotal')]: route?.whitelistTotal ?? '',
      [t('export.colCourierName')]: driverDisplayName(driver, t),
      [t('export.colCourierCode')]: driver?.courierCode ?? '',
      ...metricCells(metrics, t),
    })
  }

  for (const supplier of result.suppliers) {
    if (supplier.routes.length === 0) {
      pushRow(supplier, null, null, supplier)
      continue
    }
    for (const route of supplier.routes) {
      if (route.drivers.length === 0) {
        pushRow(supplier, route, null, route)
        continue
      }
      for (const driver of route.drivers) {
        pushRow(supplier, route, driver, driver)
      }
    }
  }
  return rows
}

/**
 * 问题运单明细：一行一单号。后端对每个司机的单号列表有截断上限（见
 * repository.ts 的 pushCapped/MAX_WAYBILL_NOS_PER_DRIVER），数量多时列不全，
 * 所以每组都标「单号是否列全」，不能悄悄漏单。
 */
export function toProblemWaybillRows(
  result: DispatchPerformanceResult,
  whitelistMode: WhitelistMode,
  t: T,
): ExportRow[] {
  const base = baseDims(result, whitelistMode, t)
  const rows: ExportRow[] = []

  for (const supplier of result.suppliers) {
    for (const route of supplier.routes) {
      for (const driver of route.drivers) {
        const dims: ExportRow = {
          ...base,
          [t('export.colSupplierName')]: supplier.supplierName,
          [t('export.colVendorCode')]: supplier.vendorCode,
          [t('export.colRouteCode')]: route.routeCode,
          [t('export.colCourierName')]: driverDisplayName(driver, t),
          [t('export.colCourierCode')]: driver.courierCode,
        }
        const groups: { kind: string; nos: string[]; expected: number }[] = [
          { kind: 'neverSigned', nos: driver.neverSignedWaybillNos, expected: driver.neverSignedCount },
          { kind: 'lateSigned', nos: driver.lateSignedWaybillNos, expected: driver.lateSignedCount },
          { kind: 'problem', nos: driver.problemWaybillNos, expected: driver.problemCount },
          {
            kind: 'before11Unmet',
            nos: driver.before11UnmetWaybillNos,
            expected: driver.total - driver.before11Met,
          },
        ]
        for (const { kind, nos, expected } of groups) {
          const listComplete =
            nos.length >= expected
              ? t('export.listComplete')
              : t('export.listTruncated', { shown: nos.length, total: expected })
          for (const no of nos) {
            rows.push({
              ...dims,
              [t('export.colWaybillNo')]: no,
              [t('export.colProblemType')]: t(`export.problemType.${kind}`),
              [t('export.colListComplete')]: listComplete,
            })
          }
        }
      }
    }
  }
  return rows
}

export function exportDispatchPerformanceToXlsx(
  result: DispatchPerformanceResult,
  whitelistMode: WhitelistMode,
  t: T,
): void {
  const mainRows = toDispatchExportRows(result, whitelistMode, t)
  if (mainRows.length === 0) {
    showToast(t('detail.exportEmpty'), 'error')
    return
  }
  const problemRows = toProblemWaybillRows(result, whitelistMode, t)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mainRows), t('export.sheetMain'))
  if (problemRows.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(problemRows), t('export.sheetProblem'))
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  saveAs(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${t('export.fileNamePrefix')}${result.stationCode}_${result.startDate}_${result.endDate}_${timestamp()}.xlsx`,
  )
}
