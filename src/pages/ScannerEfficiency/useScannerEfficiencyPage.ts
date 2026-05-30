import * as XLSX from 'xlsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  laborCostAndHoursSumByDateFromMappedRows,
  mapParsedAttendanceRowsForLabor,
} from '../../payroll/laborCostFromAttendance'
import type { RateSettings } from '../../payroll/wageRateCalculation'
import { DEFAULT_RATE_SETTINGS } from '../WageSalary/constants'
import { loadEmployeesFromStorage, loadRateSettingsFromStorage } from '../WageSalary/storage'
import {
  DEFAULT_SETTINGS,
  TAB_KEYS,
  type ScanSettings,
  type TabKey,
} from './constants'
import {
  buildScanAggregate,
  buildAttendanceAggregate,
  buildAttendanceEfficiency,
  buildScannerEfficiency,
  applyAttendanceDailyHoursOverrides,
  computeAttendanceDailyMatchAverages,
  dedupeParsedScanRowsByWaybill,
  type ParsedAllocationRow,
  type ParsedAttendanceRow,
  type ParsedScanRow,
} from './aggregates'
import {
  formatInteger,
  formatNumber,
} from './formatAndParse'
import { parseAllocationFiles, parseScanFiles, parseAttendanceFiles } from './parsers'
import { flushPaint } from './excelParseClient'
import { buildExportWorkbook, type SourceInfo } from './exportWorkbook'
import { buildFrontDeskSaturation } from './frontDeskSaturation'
import {
  buildSortingEfficiencyLookup,
  buildSortingScanCountLookup,
  sortingScanCountForPerson,
} from './sortingLookup'
import type { DataTableRow } from './components/ui'
import {
  buildAttendanceMatchColumns,
  buildAttendancePersonColumns,
  buildDailyVolumeColumns,
  buildScannerDailyColumns,
  buildScannerPersonColumns,
} from './scannerEfficiencyTableColumns'
import { buildScannerHourlyPivotTables } from './scannerHourlyPivotTable'

const EMPTY_SOURCE: SourceInfo = {
  fileCount: 0,
  rowCount: 0,
  droppedRows: 0,
  duplicateWaybillRows: 0,
  fileNames: [],
}

function mergeOrderedUniqueFileNames(prev: string[], next: string[]): string[] {
  const seen = new Set(prev)
  const out = [...prev]
  for (const name of next) {
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** 与工资页上传表默认一致：未勾选「分拣班次 / 公众假期」时的映射口径 */
const WAGE_LABOR_UPLOAD_SORTING = false
const WAGE_LABOR_UPLOAD_PUBLIC_HOLIDAY = false

export function useScannerEfficiencyPage() {
  const [settings, setSettings] = useState<ScanSettings>(() => ({ ...DEFAULT_SETTINGS }))

  const [wageEmployees, setWageEmployees] = useState<{ employeeId: string; role: string }[]>([])
  const [rateSettingsForLabor, setRateSettingsForLabor] = useState<RateSettings>(() =>
    JSON.parse(JSON.stringify(DEFAULT_RATE_SETTINGS)),
  )

  useEffect(() => {
    void (async () => {
      const emps = await loadEmployeesFromStorage()
      setWageEmployees(emps.map((e) => ({ employeeId: e.employeeId, role: e.role })))
      setRateSettingsForLabor(await loadRateSettingsFromStorage(DEFAULT_RATE_SETTINGS))
    })()
  }, [])

  const [scanRows, setScanRows] = useState<ParsedScanRow[]>([])
  const [scanSourceInfo, setScanSourceInfo] = useState<SourceInfo>(EMPTY_SOURCE)

  const scanRowsRef = useRef(scanRows)
  const scanSourceInfoRef = useRef(scanSourceInfo)

  useEffect(() => {
    scanRowsRef.current = scanRows
  }, [scanRows])

  useEffect(() => {
    scanSourceInfoRef.current = scanSourceInfo
  }, [scanSourceInfo])

  const [attendanceRows, setAttendanceRows] = useState<ParsedAttendanceRow[]>([])
  const [attendanceSourceInfo, setAttendanceSourceInfo] = useState<SourceInfo>(EMPTY_SOURCE)
  const [allocationRows, setAllocationRows] = useState<ParsedAllocationRow[]>([])
  const [allocationSourceInfo, setAllocationSourceInfo] = useState<SourceInfo>(EMPTY_SOURCE)

  const [loadingScan, setLoadingScan] = useState(false)
  const [loadingAttendance, setLoadingAttendance] = useState(false)
  const [loadingAllocation, setLoadingAllocation] = useState(false)
  const [error, setError] = useState('')
  const [manualTab, setManualTab] = useState<TabKey>(TAB_KEYS.WAREHOUSE)
  const [scannerHourlyExpanded, setScannerHourlyExpanded] = useState(false)

  const scanAggregate = useMemo(() => {
    if (!scanRows.length) return null
    return buildScanAggregate(scanRows)
  }, [scanRows])

  const attendanceAggregate = useMemo(() => {
    if (!attendanceRows.length) return null
    return buildAttendanceAggregate(attendanceRows, settings.openDayThreshold)
  }, [attendanceRows, settings.openDayThreshold])

  const attendanceEfficiencyBase = useMemo(() => {
    if (!scanAggregate || !attendanceAggregate) return null
    return buildAttendanceEfficiency(scanAggregate, attendanceAggregate)
  }, [scanAggregate, attendanceAggregate])

  const [dailyHoursOverrides, setDailyHoursOverrides] = useState<Record<string, number>>({})

  useEffect(() => {
    setDailyHoursOverrides({})
  }, [scanRows, attendanceRows])

  const attendanceResult = useMemo(() => {
    if (!attendanceEfficiencyBase) return null
    return applyAttendanceDailyHoursOverrides(attendanceEfficiencyBase, dailyHoursOverrides)
  }, [attendanceEfficiencyBase, dailyHoursOverrides])

  const handleDailyTotalHoursCommit = useCallback((date: string, value: number | null) => {
    setDailyHoursOverrides((prev) => {
      if (value === null) {
        const { [date]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [date]: value }
    })
  }, [])

  const scannerResult = useMemo(() => {
    if (!scanRows.length) return null
    return buildScannerEfficiency(scanRows, settings)
  }, [scanRows, settings])

  const frontDeskResult = useMemo(
    () =>
      buildFrontDeskSaturation({
        attendanceResult,
        attendanceRows,
        allocationRows,
        scannerResult,
        afternoonStartHour: settings.frontDeskAfternoonStartHour,
      }),
    [
      allocationRows,
      attendanceResult,
      attendanceRows,
      scannerResult,
      settings.frontDeskAfternoonStartHour,
    ],
  )

  const activeTab = useMemo((): TabKey => {
    if (manualTab === TAB_KEYS.WEEKLY) return TAB_KEYS.WEEKLY
    const coerced: TabKey | null =
      attendanceEfficiencyBase && !scannerResult
        ? TAB_KEYS.WAREHOUSE
        : !attendanceEfficiencyBase && scannerResult
          ? TAB_KEYS.SCANNER
          : !attendanceEfficiencyBase && !scannerResult
            ? TAB_KEYS.WAREHOUSE
            : null
    return coerced ?? manualTab
  }, [manualTab, attendanceEfficiencyBase, scannerResult])

  const setActiveTab = (tab: TabKey) => setManualTab(tab)

  const weeklyPanelKey = useMemo(
    () =>
      [
        scanSourceInfo.fileNames.join(','),
        String(scanSourceInfo.rowCount),
        String(scanSourceInfo.droppedRows),
        String(scanSourceInfo.duplicateWaybillRows),
        attendanceSourceInfo.fileNames.join(','),
        String(attendanceSourceInfo.rowCount),
        String(attendanceSourceInfo.droppedRows),
        String(settings.openDayThreshold),
        String(settings.breakCapMinutes),
        String(settings.splitThresholdMinutes),
        String(settings.minSingleScanSessionMinutes),
        String(settings.frontDeskAfternoonStartHour),
        allocationSourceInfo.fileNames.join(','),
        String(allocationSourceInfo.rowCount),
        String(allocationSourceInfo.droppedRows),
      ].join('|'),
    [
      scanSourceInfo.fileNames,
      scanSourceInfo.rowCount,
      scanSourceInfo.droppedRows,
      scanSourceInfo.duplicateWaybillRows,
      attendanceSourceInfo.fileNames,
      attendanceSourceInfo.rowCount,
      attendanceSourceInfo.droppedRows,
      settings.openDayThreshold,
      settings.breakCapMinutes,
      settings.splitThresholdMinutes,
      settings.minSingleScanSessionMinutes,
      settings.frontDeskAfternoonStartHour,
      allocationSourceInfo.fileNames,
      allocationSourceInfo.rowCount,
      allocationSourceInfo.droppedRows,
    ],
  )

  const laborMappedRows = useMemo(
    () =>
      mapParsedAttendanceRowsForLabor(
        attendanceRows,
        wageEmployees,
        WAGE_LABOR_UPLOAD_SORTING,
        WAGE_LABOR_UPLOAD_PUBLIC_HOLIDAY,
      ),
    [attendanceRows, wageEmployees],
  )

  const laborByDateAndHours = useMemo(() => {
    if (!attendanceResult || !attendanceRows.length) return null
    const rs = attendanceResult.summary.efficiencyRangeStart
    const re = attendanceResult.summary.efficiencyRangeEnd
    const inWin = (d: string) => d >= rs && d <= re
    return laborCostAndHoursSumByDateFromMappedRows(laborMappedRows, rateSettingsForLabor, inWin)
  }, [attendanceResult, attendanceRows.length, laborMappedRows, rateSettingsForLabor])

  const dailyCostPerTicketByDate = useMemo(() => {
    if (!attendanceResult?.dailyRows.length || !laborByDateAndHours) return undefined
    const { costByDate: laborByDate, hoursSumByDate } = laborByDateAndHours
    const rec: Record<string, number | null> = {}
    for (const r of attendanceResult.dailyRows) {
      const laborRaw = laborByDate.get(r.date) ?? 0
      const sumHMapped = hoursSumByDate.get(r.date) ?? 0
      const displayH = r.totalHours
      const laborAdj =
        sumHMapped > 0 && Number.isFinite(displayH) ? laborRaw * (displayH / sumHMapped) : laborRaw
      rec[r.date] = r.hasAttendance && r.volume > 0 ? laborAdj / r.volume : null
    }
    return rec
  }, [attendanceResult, laborByDateAndHours])

  const warehouseMetrics = useMemo(() => {
    if (!scanAggregate || !attendanceResult) return null
    return [
      {
        label: '开仓效率',
        value: `${formatNumber(attendanceResult.summary.openEfficiency, 2)} 票/小时`,
        hint: `上传总货量 ${formatInteger(attendanceResult.summary.uploadedVolume)} / 窗口内开仓日工时 ${formatNumber(
          attendanceResult.summary.openHours,
          2,
        )} 小时`,
        tone: 'dark' as const,
      },
      {
        label: '总体效率',
        value: `${formatNumber(attendanceResult.summary.overallEfficiency, 2)} 票/小时`,
        hint: `上传总货量 ${formatInteger(attendanceResult.summary.uploadedVolume)} / 窗口内全部考勤工时 ${formatNumber(
          attendanceResult.summary.allHours,
          2,
        )} 小时`,
      },
    ]
  }, [scanAggregate, attendanceResult])

  const scannerMetrics = useMemo(() => {
    if (!scanAggregate || !scannerResult) return null
    return [
      {
        label: '一级分拣效率',
        value: `${formatNumber(scannerResult.summary.totalEfficiency, 2)} 票/小时`,
        hint: `总扫描量 ${formatInteger(scannerResult.summary.totalScanCount)} / 一级分拣有效工时 ${formatNumber(
          scannerResult.summary.totalEffectiveHours,
          2,
        )}`,
        tone: 'dark' as const,
      },
      {
        label: '扫描员人数',
        value: formatInteger(scannerResult.summary.totalScanners),
        hint: '基于同源列“扫描时间/运单号/扫描员”识别',
      },
      {
        label: '统计天数',
        value: formatInteger(scannerResult.summary.totalDays),
        hint: '按“扫描员 + 日期”计算',
      },
      {
        label: '总扫描量',
        value: formatInteger(scannerResult.summary.totalScanCount),
        hint: '来自一级分拣同源口径',
      },
    ]
  }, [scanAggregate, scannerResult])

  const summaryMetrics = useMemo(() => {
    if (activeTab === TAB_KEYS.WAREHOUSE) return warehouseMetrics ?? []
    if (activeTab === TAB_KEYS.SCANNER) return scannerMetrics ?? []
    return []
  }, [activeTab, warehouseMetrics, scannerMetrics])

  const personSortingLookup = useMemo(() => buildSortingEfficiencyLookup(scannerResult), [scannerResult])
  const personSortingScanCountLookup = useMemo(
    () => buildSortingScanCountLookup(scannerResult),
    [scannerResult],
  )

  const dailyVolumeColumns = useMemo(() => buildDailyVolumeColumns(), [])
  const attendanceMatchColumns = useMemo(
    () => buildAttendanceMatchColumns({ onDailyTotalHoursCommit: handleDailyTotalHoursCommit }),
    [handleDailyTotalHoursCommit],
  )
  const attendancePersonColumns = useMemo(
    () => buildAttendancePersonColumns(personSortingLookup),
    [personSortingLookup],
  )
  const scannerDailyColumns = useMemo(() => buildScannerDailyColumns(), [])
  const scannerPersonColumns = useMemo(() => buildScannerPersonColumns(), [])

  const handleSettingChange = (key: keyof ScanSettings, value: string) => {
    const numeric = Number(value)
    setSettings((current) => ({
      ...current,
      [key]: Number.isFinite(numeric) && numeric > 0 ? numeric : current[key],
    }))
  }

  const handleScanFileChange = async (fileList: FileList | null) => {
    const files = Array.from(fileList || [])
    if (!files.length) return

    setLoadingScan(true)
    setError('')
    await flushPaint()

    try {
      const parsed = await parseScanFiles(files)
      const prevRows = scanRowsRef.current
      const prevSource = scanSourceInfoRef.current

      if (!parsed.rows.length) {
        throw new Error(
          prevRows.length
            ? '本次追加的到件扫描文件没有识别到有效日期。请确认包含“扫描时间/日期”列；已有数据未改动。'
            : '到件扫描文件没有识别到有效日期。请确认包含“扫描时间/日期”列。',
        )
      }

      const combinedRawRows = prevRows.length ? [...prevRows, ...parsed.rows] : parsed.rows
      const { rows: deduped, duplicateDropped } = dedupeParsedScanRowsByWaybill(combinedRawRows)
      if (!deduped.length) {
        throw new Error('到件扫描经运单号去重后没有可统计记录。')
      }

      setScanRows(deduped)
      const mergedNames = prevRows.length
        ? mergeOrderedUniqueFileNames(prevSource.fileNames, parsed.fileNames)
        : parsed.fileNames

      setScanSourceInfo({
        fileCount: mergedNames.length,
        rowCount: deduped.length,
        droppedRows: prevRows.length
          ? prevSource.droppedRows + parsed.droppedRows
          : parsed.droppedRows,
        duplicateWaybillRows: duplicateDropped,
        fileNames: mergedNames,
      })
    } catch (currentError: unknown) {
      setScanRows([])
      setScanSourceInfo(EMPTY_SOURCE)
      setError(currentError instanceof Error ? currentError.message : '读取到件扫描文件失败。请检查文件格式。')
    } finally {
      setLoadingScan(false)
    }
  }

  const handleAttendanceFileChange = async (fileList: FileList | null) => {
    const files = Array.from(fileList || [])

    if (!files.length) {
      setAttendanceRows([])
      setAttendanceSourceInfo(EMPTY_SOURCE)
      return
    }

    setLoadingAttendance(true)
    setError('')
    await flushPaint()

    try {
      const parsed = await parseAttendanceFiles(files)
      if (!parsed.rows.length) {
        throw new Error('考勤文件没有识别到有效工时。请确认包含“日期/总时长/人员”列。')
      }

      setAttendanceRows(parsed.rows)
      setAttendanceSourceInfo({
        fileCount: files.length,
        rowCount: parsed.rows.length,
        droppedRows: parsed.droppedRows,
        duplicateWaybillRows: 0,
        fileNames: parsed.fileNames,
      })
    } catch (currentError: unknown) {
      setAttendanceRows([])
      setAttendanceSourceInfo(EMPTY_SOURCE)
      setError(currentError instanceof Error ? currentError.message : '读取考勤文件失败。请检查文件格式。')
    } finally {
      setLoadingAttendance(false)
    }
  }

  const handleAllocationFileChange = async (fileList: FileList | null) => {
    const files = Array.from(fileList || [])

    if (!files.length) {
      setAllocationRows([])
      setAllocationSourceInfo(EMPTY_SOURCE)
      return
    }

    setLoadingAllocation(true)
    setError('')
    await flushPaint()

    try {
      const parsed = await parseAllocationFiles(files)
      if (!parsed.rows.length) {
        throw new Error('前台分配表没有识别到有效“分配时间”。请确认文件包含分配时间列。')
      }

      setAllocationRows(parsed.rows)
      setAllocationSourceInfo({
        fileCount: files.length,
        rowCount: parsed.rows.length,
        droppedRows: parsed.droppedRows,
        duplicateWaybillRows: 0,
        fileNames: parsed.fileNames,
      })
    } catch (currentError: unknown) {
      setAllocationRows([])
      setAllocationSourceInfo(EMPTY_SOURCE)
      setError(currentError instanceof Error ? currentError.message : '读取前台分配表失败。请检查文件格式。')
    } finally {
      setLoadingAllocation(false)
    }
  }

  const clearAttendance = () => {
    setAttendanceRows([])
    setAttendanceSourceInfo(EMPTY_SOURCE)
  }

  const clearAllocation = () => {
    setAllocationRows([])
    setAllocationSourceInfo(EMPTY_SOURCE)
  }

  const clearAll = () => {
    setScanRows([])
    setScanSourceInfo(EMPTY_SOURCE)
    setAttendanceRows([])
    setAttendanceSourceInfo(EMPTY_SOURCE)
    setAllocationRows([])
    setAllocationSourceInfo(EMPTY_SOURCE)
    setError('')
  }

  const handleExport = () => {
    if (!scanAggregate) return
    if (activeTab === TAB_KEYS.WEEKLY) return
    if (activeTab === TAB_KEYS.SCANNER && !scannerResult) return
    if (activeTab === TAB_KEYS.FRONT_DESK) return
    const workbook = buildExportWorkbook({
      scanAggregate,
      attendanceResult,
      scannerResult,
      sourceInfo: scanSourceInfo,
      attendanceSourceInfo,
      allocationSourceInfo,
      exportTab: activeTab === TAB_KEYS.WAREHOUSE ? TAB_KEYS.WAREHOUSE : TAB_KEYS.SCANNER,
      attendanceDailyCostPerTicket: dailyCostPerTicketByDate,
      frontDeskResult,
    })
    if (!workbook) return
    const exportName =
      activeTab === TAB_KEYS.WAREHOUSE ? '仓库效率_开仓与总体.xlsx' : '仓库效率_一级分拣.xlsx'
    XLSX.writeFile(workbook, exportName)
  }

  const hasScanData = Boolean(scanAggregate)
  const loading = loadingScan || loadingAttendance || loadingAllocation

  const dailyRowsAsTable = (scanAggregate?.dailyRows ?? []) as unknown as DataTableRow[]

  const dailyVolumeTrendPoints = useMemo(() => {
    const rows = scanAggregate?.dailyRows
    if (!rows?.length) return []
    return rows.map((r) => ({ date: r.date, value: r.volume }))
  }, [scanAggregate])

  const attendanceDayEfficiencyBubbleData = useMemo(() => {
    const rows = attendanceResult?.dailyRows
    if (!rows?.length) return []
    return rows
      .filter(
        (r) =>
          !r.isAttendanceOnly &&
          r.dayEfficiency != null &&
          Number.isFinite(r.dayEfficiency),
      )
      .map((r) => ({
        date: r.date,
        sorterCount: r.sorterCount,
        volume: r.volume,
        efficiency: r.dayEfficiency as number,
        totalHours: r.totalHours,
        costPerTicket: dailyCostPerTicketByDate?.[r.date] ?? null,
      }))
  }, [attendanceResult, dailyCostPerTicketByDate])

  const attendanceDailyAsTable = useMemo((): DataTableRow[] => {
    const rows = attendanceResult?.dailyRows ?? []
    if (!rows.length) return []
    const avgs = computeAttendanceDailyMatchAverages(rows)
    const bodyRows = rows.map((r) => {
      const c = dailyCostPerTicketByDate?.[r.date] ?? null
      return {
        ...(r as unknown as DataTableRow),
        attendanceCostPerTicket: c,
      }
    })
    const costSamples = bodyRows
      .map((r) => r.attendanceCostPerTicket)
      .filter((v): v is number => v != null && Number.isFinite(v))
    const avgCostPerTicket =
      costSamples.length > 0
        ? costSamples.reduce((a, b) => a + b, 0) / costSamples.length
        : null
    return [
      ...bodyRows,
      {
        date: '平均 / 总计',
        isAttendanceMatchFooter: true,
        isAttendanceOnly: false,
        sorterCount: 0,
        isOpenDay: false,
        hasAttendance: true,
        matchFooterStats: { ...avgs, avgCostPerTicket },
      } as DataTableRow,
    ]
  }, [attendanceResult?.dailyRows, dailyCostPerTicketByDate])

  const attendancePersonAsTable = useMemo((): DataTableRow[] => {
    const persons = attendanceEfficiencyBase?.personRows
    if (!persons?.length) return []
    const lookupScan = personSortingScanCountLookup
    return persons.map((r) => {
      const args = {
        sorterName: r.sorterName,
        sorterKey: r.sorterKey,
        efficiencyMatchNames: r.efficiencyMatchNames,
      }
      const scan = sortingScanCountForPerson(args, lookupScan)
      const hrs = r.totalHours
      const matchedScan = scan === '' ? null : scan
      const onDuty =
        matchedScan != null && Number.isFinite(hrs) && hrs > 0 ? matchedScan / hrs : null
      return {
        ...(r as unknown as DataTableRow),
        personMatchedSortingScan: matchedScan,
        personOnDutyEfficiencyPerHour: onDuty,
      }
    })
  }, [attendanceEfficiencyBase, personSortingScanCountLookup])

  const scannerDailyAsTable = (scannerResult?.dailySummaryRows ?? []) as unknown as DataTableRow[]
  const frontDeskDailyAsTable = (frontDeskResult?.dailyRows ?? []) as unknown as DataTableRow[]
  const frontDeskDensityAsTable = (frontDeskResult?.densityRows ?? []) as unknown as DataTableRow[]

  const scannerHourlyPivotTables = useMemo(
    () => buildScannerHourlyPivotTables(scannerResult?.scannerHourlyRows ?? []),
    [scannerResult?.scannerHourlyRows],
  )

  const scannerPersonAsTable = (scannerResult?.scannerTotalRows ?? []) as unknown as DataTableRow[]

  const scannerDailyEfficiencyTrendPoints = useMemo(() => {
    const rows = scannerResult?.dailySummaryRows ?? []
    return rows.map((r) => ({ date: r.date, value: r.efficiency }))
  }, [scannerResult?.dailySummaryRows])

  const openDayRuleTooltipText = `当前规则：分拣人数 > ${settings.openDayThreshold} 计入开仓日；分拣人数 ≤ ${settings.openDayThreshold} 计入不开仓日。`

  return {
    settings,
    scanSourceInfo,
    attendanceSourceInfo,
    allocationSourceInfo,
    loading,
    error,
    scannerHourlyExpanded,
    setScannerHourlyExpanded,
    scanAggregate,
    attendanceResult,
    scannerResult,
    frontDeskResult,
    activeTab,
    setActiveTab,
    weeklyPanelKey,
    summaryMetrics,
    dailyVolumeColumns,
    attendanceMatchColumns,
    attendancePersonColumns,
    scannerDailyColumns,
    scannerPersonColumns,
    handleSettingChange,
    handleScanFileChange,
    handleAttendanceFileChange,
    handleAllocationFileChange,
    clearAttendance,
    clearAllocation,
    clearAll,
    handleExport,
    hasScanData,
    dailyCostPerTicketByDate,
    dailyRowsAsTable,
    dailyVolumeTrendPoints,
    attendanceDayEfficiencyBubbleData,
    attendanceDailyAsTable,
    attendancePersonAsTable,
    scannerDailyAsTable,
    frontDeskDailyAsTable,
    frontDeskDensityAsTable,
    scannerHourlyPivotTables,
    scannerPersonAsTable,
    scannerDailyEfficiencyTrendPoints,
    openDayRuleTooltipText,
  }
}

export type ScannerEfficiencyViewModel = ReturnType<typeof useScannerEfficiencyPage>
