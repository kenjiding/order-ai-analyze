import * as XLSX from 'xlsx'
import { TAB_KEYS } from './constants'
import {
  computeAttendanceDailyMatchAverages,
  buildScannerHourlyPivotByDate,
  scannerHourSlotLabel,
  type ScanAggregate,
  type AttendanceEfficiencyResult,
  type ScannerEfficiencyResult,
} from './aggregates'
import {
  buildSortingEfficiencyLookup,
  buildSortingScanCountLookup,
  sortingAverageEfficiencyValue,
  sortingEfficiencyForPerson,
  sortingScanCountForPerson,
} from './sortingLookup'
import type { FrontDeskSaturationResult } from './frontDeskSaturation'

export type SourceInfo = {
  fileCount: number
  /** 进入统计的行数（已按运单号去重合并后） */
  rowCount: number
  droppedRows: number
  /** 解析有效但运单号与更早一条重复而剔除的行数 */
  duplicateWaybillRows: number
  fileNames: string[]
}

export type ExportTabKey =
  typeof TAB_KEYS.WAREHOUSE | typeof TAB_KEYS.SCANNER

export function buildExportWorkbook({
  scanAggregate,
  attendanceResult,
  scannerResult,
  sourceInfo,
  attendanceSourceInfo,
  allocationSourceInfo,
  exportTab,
  attendanceDailyCostPerTicket,
  attendanceDailyTotalLaborCost,
  attendancePayrollTotal,
  frontDeskResult,
}: {
  scanAggregate: ScanAggregate | null
  attendanceResult: AttendanceEfficiencyResult | null
  scannerResult: ScannerEfficiencyResult | null
  sourceInfo: SourceInfo
  attendanceSourceInfo: SourceInfo
  allocationSourceInfo: SourceInfo
  exportTab: ExportTabKey
  /** 与页面「效率明细/天」每票成本一致；键为 yyyy-MM-dd */
  attendanceDailyCostPerTicket?: Record<string, number | null>
  /** 与页面「效率明细/天」总成本一致；键为 yyyy-MM-dd */
  attendanceDailyTotalLaborCost?: Record<string, number | null>
  /** 出勤表全量工资合计，与工资页「总工资」一致 */
  attendancePayrollTotal?: number | null
  frontDeskResult?: FrontDeskSaturationResult | null
}) {
  if (!scanAggregate) return null

  const workbook = XLSX.utils.book_new()
  const summaryRows: Record<string, string | number>[] = []

  if (exportTab === TAB_KEYS.WAREHOUSE) {
    if (attendanceResult) {
      summaryRows.push({
        导出范围: '开仓效率 / 总体效率',
        统计模式: '到件 + 考勤',
        上传总货量: attendanceResult.summary.uploadedVolume,
        匹配货量: attendanceResult.summary.matchedVolume,
        效率统计窗口: `${attendanceResult.summary.efficiencyRangeStart} ~ ${attendanceResult.summary.efficiencyRangeEnd}`,
        窗口内考勤总工时_小时: Number(attendanceResult.summary.allHours.toFixed(4)),
        窗口内开仓日总工时_小时: Number(attendanceResult.summary.openHours.toFixed(4)),
        到件有考勤_交集工时_小时: Number(attendanceResult.summary.intersectionMatchHours.toFixed(4)),
        开仓效率_票每小时: Number(attendanceResult.summary.openEfficiency.toFixed(2)),
        总体效率_票每小时: Number(attendanceResult.summary.overallEfficiency.toFixed(2)),
        菜鸟票_全窗口: attendanceResult.summary.totalCainiaoVolume,
        菜鸟占比_全窗口: Number((attendanceResult.summary.cainiaoShareWindow * 100).toFixed(2)),
        菜鸟占比_开仓日: Number((attendanceResult.summary.cainiaoShareOpenDays * 100).toFixed(2)),
        一级分拣平均效率: sortingAverageEfficiencyValue(scannerResult) as number | string,
        匹配天数: attendanceResult.summary.matchedDayCount,
        未匹配天数: attendanceResult.summary.unmatchedDayCount,
        到件文件数: sourceInfo.fileCount,
        到件有效行数: sourceInfo.rowCount,
        到件无效行数: sourceInfo.droppedRows,
        运单号重复剔除行数: sourceInfo.duplicateWaybillRows,
        考勤文件数: attendanceSourceInfo.fileCount,
        考勤有效行数: attendanceSourceInfo.rowCount,
        考勤无效行数: attendanceSourceInfo.droppedRows,
        前台分配文件数: allocationSourceInfo.fileCount,
        前台分配有效行数: allocationSourceInfo.rowCount,
        前台分配无效行数: allocationSourceInfo.droppedRows,
      })
    } else {
      summaryRows.push({
        导出范围: '开仓效率 / 总体效率',
        统计模式: '仅到件货量（未上传考勤）',
        总货量: scanAggregate.summary.totalVolume,
        菜鸟票: scanAggregate.summary.totalCainiaoVolume,
        菜鸟占比_百分比: Number((scanAggregate.summary.cainiaoShareWindow * 100).toFixed(2)),
        统计天数: scanAggregate.summary.totalDays,
        一级分拣平均效率: sortingAverageEfficiencyValue(scannerResult) as number | string,
        到件文件数: sourceInfo.fileCount,
        到件有效行数: sourceInfo.rowCount,
        到件无效行数: sourceInfo.droppedRows,
        运单号重复剔除行数: sourceInfo.duplicateWaybillRows,
      })
    }

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), '核心指标')

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        scanAggregate.dailyRows.map((row) => ({
          日期: row.date,
          总货量: row.volume,
          菜鸟票: row.cainiaoVolume,
          菜鸟占比_百分比: Number((row.cainiaoShare * 100).toFixed(2)),
          扫描员人数_到件文件内: row.scannerCount,
        })),
      ),
      '到件按日',
    )

    if (attendanceResult) {
      const sortingLookup = buildSortingEfficiencyLookup(scannerResult)
      const scanCountLookup = buildSortingScanCountLookup(scannerResult)

      const costByDate = attendanceDailyCostPerTicket
      const laborByDate = attendanceDailyTotalLaborCost
      type AttendanceMatchExcelRow = {
        日期: string
        到件数据: string
        总货量: number | string
        总成本: number | string
        菜鸟占比_百分比: number | string
        分拣人数: number | string
        总工时_小时: number | string
        当天效率_票每小时: number | string
        每票成本: number | string
        是否有考勤: string
      }
      const attendanceMatchExcelRows: AttendanceMatchExcelRow[] = attendanceResult.dailyRows.map((row) => {
        const c = costByDate?.[row.date]
        const labor = laborByDate?.[row.date]
        return {
          日期: row.date,
          到件数据: row.isAttendanceOnly ? '无（不开仓）' : '有',
          总货量: row.volume,
          总成本: (() => {
            if (!row.hasAttendance) return '—'
            if (labor != null && Number.isFinite(labor)) return Number(labor.toFixed(2))
            return '—'
          })(),
          菜鸟占比_百分比:
            row.isAttendanceOnly || !(row.volume > 0)
              ? ''
              : Number((row.cainiaoShare * 100).toFixed(2)),
          分拣人数: row.sorterCount,
          总工时_小时: Number(row.totalHours.toFixed(4)),
          当天效率_票每小时: row.dayEfficiency == null ? '' : Number(row.dayEfficiency.toFixed(2)),
          每票成本: (() => {
            if (!row.hasAttendance || !(row.volume > 0)) return '—'
            if (labor != null && Number.isFinite(labor) && row.volume > 0) {
              return Number((labor / row.volume).toFixed(4))
            }
            if (c != null && Number.isFinite(c)) return Number(c.toFixed(4))
            return '—'
          })(),
          是否有考勤: row.hasAttendance ? '是' : '否',
        }
      })
      const matchAvgs = computeAttendanceDailyMatchAverages(attendanceResult.dailyRows)
      const footerEffTotal =
        matchAvgs.efficiencyFromTotals == null ? '—' : matchAvgs.efficiencyFromTotals.toFixed(2)
      const footerEffAvg =
        matchAvgs.avgDayEfficiency == null ? '—' : matchAvgs.avgDayEfficiency.toFixed(2)
      const laborSamples = attendanceResult.dailyRows
        .filter((row) => row.hasAttendance)
        .map((row) => laborByDate?.[row.date])
        .filter((v): v is number => v != null && Number.isFinite(v))
      const footerVolumeSum = attendanceResult.dailyRows.reduce(
        (sum, row) => sum + (row.volume > 0 ? row.volume : 0),
        0,
      )
      const footerLaborTotalNum =
        attendancePayrollTotal != null && Number.isFinite(attendancePayrollTotal)
          ? attendancePayrollTotal
          : laborSamples.length
            ? laborSamples.reduce((a, b) => a + b, 0)
            : null
      const footerUnitCost =
        footerLaborTotalNum != null && footerVolumeSum > 0
          ? (footerLaborTotalNum / footerVolumeSum).toFixed(4)
          : '—'
      const footerCainiaoTotalPct =
        matchAvgs.cainiaoShareFromTotals == null
          ? '—'
          : `${(matchAvgs.cainiaoShareFromTotals * 100).toFixed(2)}%`
      const footerCainiaoAvgPct =
        matchAvgs.avgCainiaoShare == null ? '—' : `${(matchAvgs.avgCainiaoShare * 100).toFixed(2)}%`
      const footerLaborTotal =
        attendancePayrollTotal != null && Number.isFinite(attendancePayrollTotal)
          ? attendancePayrollTotal.toFixed(2)
          : laborSamples.length > 0
            ? laborSamples.reduce((a, b) => a + b, 0).toFixed(2)
            : '—'
      const footerLaborAvg =
        laborSamples.length > 0
          ? (laborSamples.reduce((a, b) => a + b, 0) / laborSamples.length).toFixed(2)
          : '—'
      attendanceMatchExcelRows.push({
        日期: '平均 / 总计',
        到件数据: '—',
        总货量: `总计 ${matchAvgs.totalVolume}；平均 ${matchAvgs.avgVolume.toFixed(2)}`,
        总成本: `总计 ${footerLaborTotal}；平均 ${footerLaborAvg}`,
        菜鸟占比_百分比: `总计 ${footerCainiaoTotalPct}；平均 ${footerCainiaoAvgPct}`,
        分拣人数: '—',
        总工时_小时: `总计 ${matchAvgs.totalHoursSum.toFixed(4)}；平均 ${matchAvgs.avgTotalHours.toFixed(4)}`,
        当天效率_票每小时: `总计 ${footerEffTotal}；平均 ${footerEffAvg}`,
        每票成本: `总计 ${footerUnitCost}；平均 —`,
        是否有考勤: '—',
      })

      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(attendanceMatchExcelRows), '日期匹配明细')

      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          attendanceResult.personRows.map((row) => {
            const sortingScan = sortingScanCountForPerson(row, scanCountLookup)
            const hrs = row.totalHours
            const onsiteSorting =
              sortingScan !== '' && Number.isFinite(hrs) && hrs > 0
                ? Number((sortingScan / hrs).toFixed(2))
                : ''
            return {
              人员: row.sorterName,
              总工时_小时: Number(row.totalHours.toFixed(4)),
              扫描量: sortingScan === '' ? '' : sortingScan,
              在岗效率_票每小时: onsiteSorting === '' ? '' : onsiteSorting,
              活跃天数: row.activeDays,
              一级分拣效率: sortingEfficiencyForPerson(row, sortingLookup),
            }
          }),
        ),
        '人员工时汇总',
      )

      if (frontDeskResult) {
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            frontDeskResult.dailyRows.map((row) => ({
              日期: row.date,
              总货量: row.volume,
              总工时_小时: Number(row.totalHours.toFixed(4)),
              前台人数: row.frontDeskCount,
              前台工时_小时: Number(row.frontDeskHours.toFixed(4)),
              前台上班时间: row.frontDeskClockInLabel,
              前台最后打卡账号: row.frontDeskLastClockOutPerson,
              前台最后打卡时间: row.frontDeskLastClockOutLabel,
              前台最后打卡时间段: row.frontDeskLastClockOutSlot,
              最后箱号分配时间: row.lastAllocationLabel,
              最后分配到下班空档_分钟:
                row.offDutyIdleMinutes == null ? '' : Number(row.offDutyIdleMinutes.toFixed(2)),
              箱号分配数: row.allocationCount,
              '13点前箱号分配数': row.morningAllocationCount,
              '13点后箱号分配数': row.afternoonAllocationCount,
              分拣下班基准: row.sorterClockOutLabel,
              细分完成基准_下班前50分钟: row.sortingReadyLabel,
              '13点后集中起始分配时间(半小时段>2笔)': row.firstAfternoonAllocationLabel,
              集中起始提前滞后_分钟:
                row.firstAfternoonGapMinutes == null ? '' : Number(row.firstAfternoonGapMinutes.toFixed(2)),
              箱号每前台小时:
                row.boxesPerFrontDeskHour == null ? '' : Number(row.boxesPerFrontDeskHour.toFixed(4)),
              参考前台工时_小时:
                row.expectedFrontDeskHours == null ? '' : Number(row.expectedFrontDeskHours.toFixed(4)),
              参考冗余工时_小时:
                row.surplusFrontDeskHours == null ? '' : Number(row.surplusFrontDeskHours.toFixed(4)),
              前台分拣有效工时_小时: Number(row.frontDeskSortingEffectiveHours.toFixed(4)),
              前台分拣参与率:
                row.frontDeskSortingParticipationRate == null
                  ? ''
                  : Number((row.frontDeskSortingParticipationRate * 100).toFixed(2)),
              饱和指数:
                row.saturationIndex == null ? '' : Number(row.saturationIndex.toFixed(2)),
              状态: row.statusLabel,
            })),
          ),
          '前台饱和度',
        )

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(
            frontDeskResult.densityRows.map((row) => ({
              日期: row.date,
              时间段: row.timeSlot,
              取货窗口: row.window === 'afternoon' ? '13点后' : '13点前',
              箱号分配数: row.allocationCount,
            })),
          ),
          '箱号分配密度',
        )
      }
    }
  } else {
    if (scannerResult) {
      summaryRows.push({
        导出范围: '一级分拣个人效率',
        统计模式: '到件(含扫描员)分拣效率',
        总扫描量: scannerResult.summary.totalScanCount,
        一级分拣有效工时_小时: Number(scannerResult.summary.totalEffectiveHours.toFixed(4)),
        分拣效率_票每小时: Number(scannerResult.summary.totalEfficiency.toFixed(2)),
        统计天数: scannerResult.summary.totalDays,
        扫描员人数: scannerResult.summary.totalScanners,
        到件文件数: sourceInfo.fileCount,
        到件有效行数: sourceInfo.rowCount,
        到件无效行数: sourceInfo.droppedRows,
        运单号重复剔除行数: sourceInfo.duplicateWaybillRows,
      })
    } else {
      summaryRows.push({
        导出范围: '一级分拣个人效率',
        说明: '当前无一级分拣计算结果。请到件文件包含可识别的「扫描时间 / 运单号 / 扫描员」列后重试。',
        总货量_到件: scanAggregate.summary.totalVolume,
        统计天数_到件: scanAggregate.summary.totalDays,
        到件文件数: sourceInfo.fileCount,
        到件有效行数: sourceInfo.rowCount,
        到件无效行数: sourceInfo.droppedRows,
        运单号重复剔除行数: sourceInfo.duplicateWaybillRows,
      })
    }

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), '核心指标')

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        scanAggregate.dailyRows.map((row) => ({
          日期: row.date,
          总货量: row.volume,
          菜鸟票: row.cainiaoVolume,
          菜鸟占比_百分比: Number((row.cainiaoShare * 100).toFixed(2)),
          扫描员人数_到件文件内: row.scannerCount,
        })),
      ),
      '到件按日',
    )

    if (scannerResult) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          scannerResult.scannerTotalRows.map((row) => ({
            扫描员: row.scanner,
            总扫描量: row.scanCount,
            活跃天数: row.activeDays,
            一级分拣有效工时: Number(row.effectiveHours.toFixed(4)),
            '总效率(票/h)': Number(row.efficiency.toFixed(2)),
            可靠度: `${Number((row.reliabilityWeight * 100).toFixed(0))}%`,
            '修正效率(票/h)': Number(row.adjustedEfficiency.toFixed(2)),
          })),
        ),
        '扫描员汇总',
      )

      const pivots = buildScannerHourlyPivotByDate(scannerResult.scannerHourlyRows)
      const hourlyAoa: (string | number)[][] = []
      for (const p of pivots) {
        hourlyAoa.push([`日期: ${p.date}`])
        hourlyAoa.push(['扫描员', ...p.hours.map((h) => scannerHourSlotLabel(h)), '当日合计'])
        for (const sr of p.scannerRows) {
          hourlyAoa.push([sr.scanner, ...sr.byHour, sr.dayTotal])
        }
        hourlyAoa.push(['时段合计', ...p.columnTotals, p.grandTotal])
        hourlyAoa.push([])
      }
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(hourlyAoa), '扫描员按小时')

      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          scannerResult.dailySummaryRows.map((row) => ({
            日期: row.date,
            扫描量: row.scanCount,
            扫描员人数: row.scannerCount,
            有效工时_小时: Number(row.effectiveHours.toFixed(4)),
            效率_票每小时: Number(row.efficiency.toFixed(2)),
          })),
        ),
        '分拣按日',
      )
    }
  }

  return workbook
}
