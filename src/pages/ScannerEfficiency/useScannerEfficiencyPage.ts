import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppSettings } from '../../context/AppSettingsContext'
import {
  buildDailyLaborCostFromPayrollByDate,
  computeAttendancePayrollFromFiles,
  type AttendancePayrollResult,
} from '../../payroll/attendancePayrollFromUpload'
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
  dedupeParsedAttendanceRowsByPersonDay,
  type ParsedAllocationRow,
  type ParsedAttendanceRow,
  type ParsedScanRow,
} from './aggregates'
import { formatCainiaoSharePercent } from './cainiaoWaybill'
import {
  formatInteger,
  formatNumber,
} from './formatAndParse'
import { parseAllocationFiles, parseScanFiles, parseAttendanceFiles } from './parsers'
import {
  dedupeParsedAllocationRows,
  mapAssignedListRecordsToParsedAllocationRows,
} from './assignedListMapper'
import { fetchBoxAssignedList, fetchCancelScanAnalysis, fetchInboundScans, saveDailyEfficiencyRecords } from './scannerEfficiencyApi'
import { mapInboundRecordsToParsedScanRows } from './inboundScanMapper'
import type { CancelScanAnalysisState } from './cancelScanAnalysisTypes'
import { flushPaint } from './excelParseClient'
import { buildAllocationDensity, buildFrontDeskClockOutDays } from './frontDeskSaturation'
import {
  buildDailyEfficiencyRecordSnapshots,
  buildRestoreStateFromDailyPayloads,
  type DailyEfficiencyRecordPayload,
  type DailyEfficiencyRestoreState,
} from './dailyEfficiencyRecordSnapshot'
import type { SourceInfo } from './sourceInfo'
import { buildScannerTotalEfficiencyRows, sortingScanCountForPerson } from './sortingLookup'
import type { DataTableRow } from './components/ui'
import { showToast } from '../../utils/toast'
import {
  buildAttendanceMatchColumns,
  buildAttendancePersonColumns,
  buildDailyVolumeColumns,
  buildScannerDailyColumns,
  buildScannerPersonColumns,
  buildScannerTotalEfficiencyColumns,
} from './scannerEfficiencyTableColumns'
import { buildScannerHourlyPivotTables } from './scannerHourlyPivotTable'
import { buildAttendanceWeeklySummaryTableRows } from './attendanceEfficiencyWeek'
import type { EfficiencyDetailDimension } from './DailyEfficiencyBubbleChart'

const EMPTY_SOURCE: SourceInfo = {
  fileCount: 0,
  rowCount: 0,
  droppedRows: 0,
  duplicateWaybillRows: 0,
  fileNames: [],
}

export type InboundApiFetchStats = {
  dateRange: string
  totalResult: number
  fetched: number
  mapped: number
  sortingEligible: number
  parseDropped: number
  afterDedupe: number
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

function mergeOrderedUniqueFiles(prev: File[], next: File[]): File[] {
  const seen = new Set(prev.map((file) => file.name))
  const out = [...prev]
  for (const file of next) {
    if (seen.has(file.name)) continue
    seen.add(file.name)
    out.push(file)
  }
  return out
}

/** 与工资页上传表默认一致：未勾选「分拣班次 / 公众假期」时的映射口径 */

export function useScannerEfficiencyPage() {
  const { imileToken, imilePortal } = useAppSettings()
  const location = useLocation()
  const navigate = useNavigate()
  const [settings, setSettings] = useState<ScanSettings>(() => ({ ...DEFAULT_SETTINGS }))
  const [snapshotRestore, setSnapshotRestore] = useState<DailyEfficiencyRestoreState | null>(null)
  const [savingDailyRecords, setSavingDailyRecords] = useState(false)

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

  const refreshAttendancePayroll = useCallback(async (files: File[]) => {
    if (!files.length) {
      setAttendancePayroll(null)
      return
    }
    const payroll = await computeAttendancePayrollFromFiles(files, wageEmployees, rateSettingsForLabor)
    setAttendancePayroll(payroll)
  }, [wageEmployees, rateSettingsForLabor])

  useEffect(() => {
    void refreshAttendancePayroll(lastAttendanceFilesRef.current)
  }, [refreshAttendancePayroll])

  const [scanRows, setScanRows] = useState<ParsedScanRow[]>([])
  const [scanSourceInfo, setScanSourceInfo] = useState<SourceInfo>(EMPTY_SOURCE)
  const [lastInboundApiStats, setLastInboundApiStats] = useState<InboundApiFetchStats | null>(null)

  const scanRowsRef = useRef(scanRows)
  const scanSourceInfoRef = useRef(scanSourceInfo)

  useEffect(() => {
    scanRowsRef.current = scanRows
  }, [scanRows])

  useEffect(() => {
    scanSourceInfoRef.current = scanSourceInfo
  }, [scanSourceInfo])

  const [attendanceRows, setAttendanceRows] = useState<ParsedAttendanceRow[]>([])
  /** 与工资结算「计算薪资」同款结果；总成本只看此对象 */
  const [attendancePayroll, setAttendancePayroll] = useState<AttendancePayrollResult | null>(null)
  const lastAttendanceFilesRef = useRef<File[]>([])
  const [attendanceSourceInfo, setAttendanceSourceInfo] = useState<SourceInfo>(EMPTY_SOURCE)

  const attendanceRowsRef = useRef(attendanceRows)
  const attendanceSourceInfoRef = useRef(attendanceSourceInfo)

  useEffect(() => {
    attendanceRowsRef.current = attendanceRows
  }, [attendanceRows])

  useEffect(() => {
    attendanceSourceInfoRef.current = attendanceSourceInfo
  }, [attendanceSourceInfo])
  const [allocationRows, setAllocationRows] = useState<ParsedAllocationRow[]>([])
  const [allocationSourceInfo, setAllocationSourceInfo] = useState<SourceInfo>(EMPTY_SOURCE)

  const allocationRowsRef = useRef(allocationRows)
  const allocationSourceInfoRef = useRef(allocationSourceInfo)

  useEffect(() => {
    allocationRowsRef.current = allocationRows
  }, [allocationRows])

  useEffect(() => {
    allocationSourceInfoRef.current = allocationSourceInfo
  }, [allocationSourceInfo])

  const [loadingScan, setLoadingScan] = useState(false)
  const [loadingAttendance, setLoadingAttendance] = useState(false)
  const [loadingAllocation, setLoadingAllocation] = useState(false)
  const [loadingAllocationApi, setLoadingAllocationApi] = useState(false)
  const [loadingCancelScanAnalysis, setLoadingCancelScanAnalysis] = useState(false)
  const [cancelScanAnalysis, setCancelScanAnalysis] = useState<CancelScanAnalysisState | null>(null)
  const [error, setError] = useState('')
  const [manualTab, setManualTab] = useState<TabKey>(TAB_KEYS.WAREHOUSE)
  const [scannerHourlyExpanded, setScannerHourlyExpanded] = useState(false)
  const [efficiencyDetailDimension, setEfficiencyDetailDimension] =
    useState<EfficiencyDetailDimension>('day')
  const [efficiencyChartOpenDaysOnly, setEfficiencyChartOpenDaysOnly] = useState(true)
  const [efficiencyDetailExpandedWeekKeys, setEfficiencyDetailExpandedWeekKeys] = useState<
    Set<string>
  >(() => new Set())

  const handleEfficiencyChartOpenDaysOnlyChange = useCallback((next: boolean) => {
    setEfficiencyChartOpenDaysOnly(next)
  }, [])

  const handleEfficiencyDetailDimensionChange = useCallback((next: EfficiencyDetailDimension) => {
    setEfficiencyDetailDimension(next)
    if (next === 'day') setEfficiencyDetailExpandedWeekKeys(new Set())
  }, [])

  const handleEfficiencyDetailWeekRowClick = useCallback((row: DataTableRow) => {
    const weekKey = String(row.weekKey ?? '')
    if (!weekKey || !row.isWeekSummaryRow) return
    setEfficiencyDetailExpandedWeekKeys((prev) => {
      const next = new Set(prev)
      if (next.has(weekKey)) next.delete(weekKey)
      else next.add(weekKey)
      return next
    })
  }, [])

  const scanAggregate = useMemo(() => {
    if (snapshotRestore) return snapshotRestore.scanAggregate
    if (!scanRows.length) return null
    return buildScanAggregate(scanRows)
  }, [scanRows, snapshotRestore])

  const attendanceAggregate = useMemo(() => {
    if (snapshotRestore) return null
    if (!attendanceRows.length) return null
    return buildAttendanceAggregate(attendanceRows, settings.openDayThreshold)
  }, [attendanceRows, settings.openDayThreshold, snapshotRestore])

  const attendanceEfficiencyBase = useMemo(() => {
    if (snapshotRestore) return snapshotRestore.attendanceResult
    if (!scanAggregate || !attendanceAggregate) return null
    return buildAttendanceEfficiency(scanAggregate, attendanceAggregate)
  }, [scanAggregate, attendanceAggregate, snapshotRestore])

  const [dailyHoursOverrides, setDailyHoursOverrides] = useState<Record<string, number>>({})

  useEffect(() => {
    setDailyHoursOverrides({})
  }, [scanRows, attendanceRows])

  const attendanceResult = useMemo(() => {
    if (snapshotRestore) return snapshotRestore.attendanceResult
    if (!attendanceEfficiencyBase) return null
    return applyAttendanceDailyHoursOverrides(attendanceEfficiencyBase, dailyHoursOverrides)
  }, [attendanceEfficiencyBase, dailyHoursOverrides, snapshotRestore])

  const handleDailyTotalHoursCommit = useCallback((date: string, value: number | null) => {
    if (snapshotRestore) return
    setDailyHoursOverrides((prev) => {
      if (value === null) {
        const { [date]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [date]: value }
    })
  }, [snapshotRestore])

  const scannerResult = useMemo(() => {
    if (snapshotRestore) return snapshotRestore.scannerResult
    if (!scanRows.length) return null
    return buildScannerEfficiency(scanRows, settings)
  }, [scanRows, settings, snapshotRestore])

  const allocationDensityRows = useMemo(
    () => snapshotRestore?.allocationDensityRows ?? buildAllocationDensity(allocationRows),
    [allocationRows, snapshotRestore],
  )

  const frontDeskClockOutRows = useMemo(
    () =>
      snapshotRestore?.frontDeskClockOutRows ??
      buildFrontDeskClockOutDays({ attendanceRows, allocationRows }),
    [attendanceRows, allocationRows, snapshotRestore],
  )

  const activeTab = useMemo((): TabKey => {
    if (manualTab === TAB_KEYS.WEEKLY) return TAB_KEYS.WEEKLY
    if (manualTab === TAB_KEYS.PUSH) return TAB_KEYS.PUSH
    if (manualTab === TAB_KEYS.CANCEL_SCAN) return TAB_KEYS.CANCEL_SCAN
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
        snapshotRestore?.restoredDates.join(',') ?? '',
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
        allocationSourceInfo.fileNames.join(','),
        String(allocationSourceInfo.rowCount),
        String(allocationSourceInfo.droppedRows),
      ].join('|'),
    [
      snapshotRestore?.restoredDates,
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
      allocationSourceInfo.fileNames,
      allocationSourceInfo.rowCount,
      allocationSourceInfo.droppedRows,
    ],
  )

  const dailyLaborCostByDate = useMemo(() => {
    if (!attendanceResult?.dailyRows.length || !attendancePayroll) return undefined
    return buildDailyLaborCostFromPayrollByDate(
      attendanceResult.dailyRows,
      attendancePayroll.wagesByDate,
    )
  }, [attendanceResult, attendancePayroll])

  const dailyCostPerTicketByDate = useMemo(() => {
    if (!dailyLaborCostByDate) return undefined
    const rec: Record<string, number | null> = {}
    for (const [date, metrics] of Object.entries(dailyLaborCostByDate)) {
      rec[date] = metrics.costPerTicket
    }
    return rec
  }, [dailyLaborCostByDate])

  const dailyTotalLaborCostByDate = useMemo(() => {
    if (!dailyLaborCostByDate) return undefined
    const rec: Record<string, number | null> = {}
    for (const [date, metrics] of Object.entries(dailyLaborCostByDate)) {
      rec[date] = metrics.totalLaborCost
    }
    return rec
  }, [dailyLaborCostByDate])

  /** 与工资页「总工资」相同 */
  const attendancePayrollTotal = attendancePayroll?.totalWages ?? null

  const warehouseMetrics = useMemo(() => {
    if (!scanAggregate || !attendanceResult) return null
    return [
      {
        label: '开仓效率',
        value: `${formatNumber(attendanceResult.summary.openEfficiency, 2)} 票/小时`,
        hint: `上传总货量 ${formatInteger(attendanceResult.summary.uploadedVolume)} / 窗口内开仓日工时 ${formatNumber(
          attendanceResult.summary.openHours,
          2,
        )} 小时；菜鸟占比 ${formatCainiaoSharePercent(attendanceResult.summary.cainiaoShareOpenDays)}（开仓日）`,
        tone: 'dark' as const,
      },
      {
        label: '总体效率',
        value: `${formatNumber(attendanceResult.summary.overallEfficiency, 2)} 票/小时`,
        hint: `上传总货量 ${formatInteger(attendanceResult.summary.uploadedVolume)} / 窗口内全部考勤工时 ${formatNumber(
          attendanceResult.summary.allHours,
          2,
        )} 小时；菜鸟占比 ${formatCainiaoSharePercent(attendanceResult.summary.cainiaoShareWindow)}（全窗口）`,
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

  const dailyVolumeColumns = useMemo(() => buildDailyVolumeColumns(), [])
  const attendanceMatchColumns = useMemo(
    () => buildAttendanceMatchColumns({ onDailyTotalHoursCommit: handleDailyTotalHoursCommit }),
    [handleDailyTotalHoursCommit],
  )
  const attendancePersonColumns = useMemo(
    () => buildAttendancePersonColumns(scannerResult),
    [scannerResult],
  )
  const scannerDailyColumns = useMemo(() => buildScannerDailyColumns(), [])
  const scannerPersonColumns = useMemo(() => buildScannerPersonColumns(), [])
  const scannerTotalEfficiencyColumns = useMemo(() => buildScannerTotalEfficiencyColumns(), [])

  const clearSnapshotRestore = useCallback(() => {
    setSnapshotRestore(null)
  }, [])

  const dismissSnapshotRestore = useCallback(() => {
    setSnapshotRestore(null)
    setScanRows([])
    setScanSourceInfo(EMPTY_SOURCE)
    setLastInboundApiStats(null)
    setAttendanceRows([])
    setAttendanceSourceInfo(EMPTY_SOURCE)
    setAttendancePayroll(null)
    lastAttendanceFilesRef.current = []
    setAllocationRows([])
    setAllocationSourceInfo(EMPTY_SOURCE)
    setDailyHoursOverrides({})
    setCancelScanAnalysis(null)
    setError('')
  }, [])

  const applyDailyRecordRestore = useCallback((payloads: DailyEfficiencyRecordPayload[]) => {
    const restore = buildRestoreStateFromDailyPayloads(payloads)
    setSnapshotRestore(restore)
    setSettings((current) => ({ ...current, ...restore.settings }))
    setScanRows([])
    setAttendanceRows(restore.attendanceRows)
    setAllocationRows([])
    setScanSourceInfo(restore.scanSourceInfo)
    setAttendanceSourceInfo(restore.attendanceSourceInfo)
    setAllocationSourceInfo(restore.allocationSourceInfo)
    setAttendancePayroll(null)
    lastAttendanceFilesRef.current = []
    setLastInboundApiStats(null)
    setDailyHoursOverrides({})
    setError('')
  }, [])

  useEffect(() => {
    const state = location.state as {
      restoreDailyRecord?: DailyEfficiencyRecordPayload
      restoreDailyRecords?: DailyEfficiencyRecordPayload[]
    } | null
    const payloads = state?.restoreDailyRecords?.length
      ? state.restoreDailyRecords
      : state?.restoreDailyRecord
        ? [state.restoreDailyRecord]
        : null
    if (!payloads?.length) return
    applyDailyRecordRestore(payloads)
    navigate(location.pathname, { replace: true, state: null })
  }, [applyDailyRecordRestore, location.pathname, location.state, navigate])

  const canSaveDailyRecords = Boolean(
    !snapshotRestore && scanAggregate && attendanceResult && attendanceRows.length,
  )

  const handleSaveDailyRecords = useCallback(async () => {
    if (!canSaveDailyRecords || !attendanceResult) return

    setSavingDailyRecords(true)
    setError('')
    try {
      const records = buildDailyEfficiencyRecordSnapshots({
        attendanceResult,
        attendanceRows,
        scannerResult,
        allocationDensityRows,
        frontDeskClockOutRows,
        cancelScanAnalysis,
        settings,
        scanSourceInfo,
        attendanceSourceInfo,
        allocationSourceInfo,
      })
      if (!records.length) {
        throw new Error('当前没有可保存的按日效率记录')
      }
      const { savedCount } = await saveDailyEfficiencyRecords(records)
      showToast(`已保存 ${savedCount} 天到效率考勤记录`, 'success')
    } catch (currentError: unknown) {
      const message = currentError instanceof Error ? currentError.message : '保存效率考勤记录失败'
      showToast(message, 'error')
    } finally {
      setSavingDailyRecords(false)
    }
  }, [
    allocationDensityRows,
    allocationSourceInfo,
    cancelScanAnalysis,
    attendanceResult,
    attendanceRows,
    attendanceSourceInfo,
    canSaveDailyRecords,
    frontDeskClockOutRows,
    scanAggregate,
    scanSourceInfo,
    scannerResult,
    settings,
  ])

  const handleSettingChange = (key: keyof ScanSettings, value: string) => {
    if (snapshotRestore) return
    const numeric = Number(value)
    setSettings((current) => ({
      ...current,
      [key]: Number.isFinite(numeric) && numeric > 0 ? numeric : current[key],
    }))
  }

  const handleScanFileChange = async (fileList: FileList | null) => {
    const files = Array.from(fileList || [])
    if (!files.length) return

    clearSnapshotRestore()
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
      setError(currentError instanceof Error ? currentError.message : '读取到件扫描文件失败。请检查文件格式。')
    } finally {
      setLoadingScan(false)
    }
  }

  const handleScanApiFetch = async (startDate: string, endDate: string) => {
    const token = imileToken.trim()
    if (!token) {
      setError('请先在全局设置中配置 iMile Token')
      return
    }
    if (!startDate || !endDate) {
      setError('请选择有效的日期区间')
      return
    }

    clearSnapshotRestore()
    setLoadingScan(true)
    setError('')
    await flushPaint()

    const loadCancelScanAnalysisAsync = async () => {
      setLoadingCancelScanAnalysis(true)
      try {
        const result = await fetchCancelScanAnalysis({
          imileToken: token,
          startDate,
          endDate,
          imilePortal,
        })

        console.group(`[ScannerEfficiency] 取消扫描分析 API 原始数据 ${startDate} ~ ${endDate}`)
        console.log('cancelScanRecords', result.cancelScanRecords)
        console.log('waybillRecords', result.waybillRecords)
        console.log('routeCodeDistribution', result.routeCodeDistribution)
        console.log('raw', result.raw)
        console.groupEnd()

        setCancelScanAnalysis({
          dateRange: `${startDate} ~ ${endDate}`,
          routeCodeDistribution: result.routeCodeDistribution,
          dailyRouteCodeCounts: result.dailyRouteCodeCounts,
          meta: result.meta,
        })

        if (result.meta.cancelScanFetched === 0) {
          showToast('所选日期区间内没有取消扫描记录。', 'warning')
          return
        }

        showToast(
          `取消扫描分析完成：${formatInteger(result.meta.cancelScanFetched)} 条记录，${formatInteger(result.routeCodeDistribution.length)} 种路由码`,
          'success',
        )
      } catch (currentError: unknown) {
        const message =
          currentError instanceof Error ? currentError.message : '取消扫描分析拉取失败'
        showToast(message, 'error')
      } finally {
        setLoadingCancelScanAnalysis(false)
      }
    }

    void loadCancelScanAnalysisAsync()

    const loadBoxAssignedListAsync = async () => {
      setLoadingAllocationApi(true)
      try {
        const result = await fetchBoxAssignedList({
          imileToken: token,
          startDate,
          endDate,
          imilePortal,
        })

        console.group(`[ScannerEfficiency] iMile 前台分配 API 原始数据 ${startDate} ~ ${endDate}`)
        console.log('records（resultObject.results，未裁剪）', result.records)
        console.log('raw（完整分页 HTTP JSON）', result.raw)
        console.groupEnd()

        const sourceLabel = `iMile 前台分配 API（${startDate} ~ ${endDate}）`
        const mapped = mapAssignedListRecordsToParsedAllocationRows(result.records, sourceLabel)
        const prevRows = allocationRowsRef.current
        const prevSource = allocationSourceInfoRef.current

        console.info('[ScannerEfficiency] iMile 前台分配 API 拉取完成', {
          dateRange: `${startDate} ~ ${endDate}`,
          apiTotalResult: result.meta.totalResult,
          apiFetched: result.records.length,
          mappedRows: mapped.rows.length,
          mappedDropped: mapped.droppedRows,
        })

        if (!mapped.rows.length) {
          showToast(
            prevRows.length
              ? '本次前台分配 API 没有可统计记录，已有分配数据未改动。'
              : '所选日期区间内没有可统计的前台分配记录。',
            'warning',
          )
          return
        }

        const combinedRawRows = prevRows.length ? [...prevRows, ...mapped.rows] : mapped.rows
        const { rows: deduped, duplicateDropped } = dedupeParsedAllocationRows(combinedRawRows)
        if (!deduped.length) {
          showToast('前台分配经去重后没有可统计记录。', 'warning')
          return
        }

        setAllocationRows(deduped)
        const mergedNames = prevRows.length
          ? mergeOrderedUniqueFileNames(prevSource.fileNames, [sourceLabel])
          : [sourceLabel]

        setAllocationSourceInfo({
          fileCount: mergedNames.length,
          rowCount: deduped.length,
          droppedRows: prevRows.length
            ? prevSource.droppedRows + mapped.droppedRows
            : mapped.droppedRows,
          duplicateWaybillRows: duplicateDropped,
          fileNames: mergedNames,
        })

        showToast(
          `前台分配 API 已载入 ${formatInteger(deduped.length)} 条（${startDate} ~ ${endDate}）`,
          'success',
        )
      } catch (currentError: unknown) {
        const message =
          currentError instanceof Error ? currentError.message : 'iMile 前台分配 API 拉取失败'
        showToast(message, 'error')
      } finally {
        setLoadingAllocationApi(false)
      }
    }

    try {
      const result = await fetchInboundScans({
        imileToken: token,
        startDate,
        endDate,
        imilePortal,
      })

      console.group(`[ScannerEfficiency] iMile 到件 API 原始数据 ${startDate} ~ ${endDate}`)
      console.log('records（resultObject.results，未裁剪）', result.records)
      console.log('raw（完整分页 HTTP JSON）', result.raw)
      console.groupEnd()

      const sourceLabel = `iMile 到件 API（${startDate} ~ ${endDate}）`
      const mapped = mapInboundRecordsToParsedScanRows(result.records, sourceLabel)
      const prevRows = scanRowsRef.current
      const prevSource = scanSourceInfoRef.current

      console.info('[ScannerEfficiency] iMile 到件 API 拉取完成', {
        dateRange: `${startDate} ~ ${endDate}`,
        apiTotalResult: result.meta.totalResult,
        apiFetched: result.records.length,
        mappedRows: mapped.rows.length,
        mappedDropped: mapped.droppedRows,
        sortingEligible: mapped.sortingEligibleCount,
      })

      if (!mapped.rows.length) {
        throw new Error(
          prevRows.length
            ? '本次 API 拉取没有可统计的到件记录，已有数据未改动。'
            : '所选日期区间内没有可统计的到件记录。',
        )
      }

      const combinedRawRows = prevRows.length ? [...prevRows, ...mapped.rows] : mapped.rows
      const { rows: deduped, duplicateDropped } = dedupeParsedScanRowsByWaybill(combinedRawRows)
      if (!deduped.length) {
        throw new Error('到件扫描经运单号去重后没有可统计记录。')
      }

      console.info('[ScannerEfficiency] iMile 到件计入统计', {
        afterDedupe: deduped.length,
        duplicateDropped,
      })

      setScanRows(deduped)
      setLastInboundApiStats({
        dateRange: `${startDate} ~ ${endDate}`,
        totalResult: result.meta.totalResult,
        fetched: result.records.length,
        mapped: mapped.rows.length,
        sortingEligible: mapped.sortingEligibleCount,
        parseDropped: mapped.droppedRows,
        afterDedupe: deduped.length,
      })
      const mergedNames = prevRows.length
        ? mergeOrderedUniqueFileNames(prevSource.fileNames, [sourceLabel])
        : [sourceLabel]

      setScanSourceInfo({
        fileCount: mergedNames.length,
        rowCount: deduped.length,
        droppedRows: prevRows.length
          ? prevSource.droppedRows + mapped.droppedRows
          : mapped.droppedRows,
        duplicateWaybillRows: duplicateDropped,
        fileNames: mergedNames,
      })

      void loadBoxAssignedListAsync()
    } catch (currentError: unknown) {
      setError(currentError instanceof Error ? currentError.message : 'iMile 到件 API 拉取失败')
    } finally {
      setLoadingScan(false)
    }
  }

  const handleAttendanceFileChange = async (fileList: FileList | null) => {
    const files = Array.from(fileList || [])
    if (!files.length) return

    clearSnapshotRestore()
    setLoadingAttendance(true)
    setError('')
    await flushPaint()

    try {
      const parsed = await parseAttendanceFiles(files)
      const prevRows = attendanceRowsRef.current
      const prevSource = attendanceSourceInfoRef.current
      const prevFiles = lastAttendanceFilesRef.current

      if (!parsed.rows.length) {
        throw new Error(
          prevRows.length
            ? '本次追加的考勤文件没有识别到有效工时。请确认包含“日期、人员”，以及“工作时长”或“总时长”列；已有数据未改动。'
            : '考勤文件没有识别到有效工时。请确认包含“日期、人员”，以及“工作时长”或“总时长”列。',
        )
      }

      const combinedRawRows = prevRows.length ? [...prevRows, ...parsed.rows] : parsed.rows
      const { rows: deduped, duplicateDropped } = dedupeParsedAttendanceRowsByPersonDay(combinedRawRows)
      if (!deduped.length) {
        throw new Error('考勤经同人同日去重后没有可统计记录。')
      }

      const mergedFiles = prevFiles.length ? mergeOrderedUniqueFiles(prevFiles, files) : files
      const mergedNames = prevFiles.length
        ? mergeOrderedUniqueFileNames(prevSource.fileNames, parsed.fileNames)
        : parsed.fileNames

      setAttendanceRows(deduped)
      setAttendanceSourceInfo({
        fileCount: mergedNames.length,
        rowCount: deduped.length,
        droppedRows: prevRows.length
          ? prevSource.droppedRows + parsed.droppedRows
          : parsed.droppedRows,
        duplicateWaybillRows: duplicateDropped,
        fileNames: mergedNames,
      })

      lastAttendanceFilesRef.current = mergedFiles
      const payroll = await computeAttendancePayrollFromFiles(
        mergedFiles,
        wageEmployees,
        rateSettingsForLabor,
      )
      setAttendancePayroll(payroll)
      if (payroll.validationErrors.length > 0) {
        setError(
          `考勤工资：${payroll.wageRows.length} 条有效记录已计入总成本；${payroll.validationErrors.length} 条未通过工资页同款校验（与工资结算上传提示一致）。`,
        )
      }
    } catch (currentError: unknown) {
      setError(currentError instanceof Error ? currentError.message : '读取考勤文件失败。请检查文件格式。')
    } finally {
      setLoadingAttendance(false)
    }
  }

  const handleAllocationFileChange = async (fileList: FileList | null) => {
    const files = Array.from(fileList || [])

    if (!files.length) {
      clearSnapshotRestore()
      setAllocationRows([])
      setAllocationSourceInfo(EMPTY_SOURCE)
      return
    }

    clearSnapshotRestore()
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
    setAttendancePayroll(null)
    lastAttendanceFilesRef.current = []
  }

  const clearAllocation = () => {
    clearSnapshotRestore()
    setAllocationRows([])
    setAllocationSourceInfo(EMPTY_SOURCE)
  }

  const clearAll = () => {
    clearSnapshotRestore()
    setScanRows([])
    setScanSourceInfo(EMPTY_SOURCE)
    setLastInboundApiStats(null)
    setAttendanceRows([])
    setAttendanceSourceInfo(EMPTY_SOURCE)
    setAttendancePayroll(null)
    lastAttendanceFilesRef.current = []
    setAllocationRows([])
    setAllocationSourceInfo(EMPTY_SOURCE)
    setCancelScanAnalysis(null)
    setError('')
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
        cainiaoVolume: r.cainiaoVolume,
        cainiaoShare: r.volume > 0 ? r.cainiaoShare : null,
        efficiency: r.dayEfficiency as number,
        totalHours: r.totalHours,
        costPerTicket: dailyCostPerTicketByDate?.[r.date] ?? null,
        totalLaborCost: dailyTotalLaborCostByDate?.[r.date] ?? null,
      }))
  }, [attendanceResult, dailyCostPerTicketByDate, dailyTotalLaborCostByDate])

  const attendanceDailyAsTable = useMemo((): DataTableRow[] => {
    const rows = attendanceResult?.dailyRows ?? []
    if (!rows.length) return []
    const avgs = computeAttendanceDailyMatchAverages(rows)
    const bodyRows = rows.map((r) => {
      const c = dailyCostPerTicketByDate?.[r.date] ?? null
      const labor = dailyTotalLaborCostByDate?.[r.date] ?? null
      return {
        ...(r as unknown as DataTableRow),
        attendanceCostPerTicket: c,
        attendanceTotalLaborCost: labor,
      }
    })
    const totalLaborCostSum = attendancePayrollTotal
    const payrollDaysWithCost = attendancePayroll
      ? Object.values(attendancePayroll.wagesByDate).filter((v) => v > 0).length
      : 0
    const avgTotalLaborCost =
      totalLaborCostSum != null && payrollDaysWithCost > 0
        ? totalLaborCostSum / payrollDaysWithCost
        : null
    const totalVolumeForUnitCost = rows.reduce(
      (sum, r) => sum + (Number(r.volume) > 0 ? Number(r.volume) : 0),
      0,
    )
    const costPerTicketFromTotals =
      totalLaborCostSum != null && totalVolumeForUnitCost > 0
        ? totalLaborCostSum / totalVolumeForUnitCost
        : null
    return [
      ...bodyRows,
      {
        date: '总计',
        isAttendanceMatchFooter: true,
        isAttendanceOnly: false,
        sorterCount: 0,
        isOpenDay: false,
        hasAttendance: true,
        matchFooterStats: {
          ...avgs,
          avgCostPerTicket: costPerTicketFromTotals,
          costPerTicketFromTotals,
          totalLaborCostSum,
          avgTotalLaborCost,
        },
      } as DataTableRow,
    ]
  }, [
    attendanceResult?.dailyRows,
    dailyCostPerTicketByDate,
    dailyTotalLaborCostByDate,
    attendancePayrollTotal,
    attendancePayroll,
  ])

  const attendanceWeeklyAsTable = useMemo((): DataTableRow[] => {
    const rows = attendanceResult?.dailyRows ?? []
    if (!rows.length) return []
    return buildAttendanceWeeklySummaryTableRows({
      dailyRows: rows,
      dailyCostPerTicketByDate,
      dailyTotalLaborCostByDate,
      attendancePayrollTotal,
      attendancePayroll,
    })
  }, [
    attendanceResult?.dailyRows,
    dailyCostPerTicketByDate,
    dailyTotalLaborCostByDate,
    attendancePayrollTotal,
    attendancePayroll,
  ])

  const attendancePersonAsTable = useMemo((): DataTableRow[] => {
    const persons = attendanceEfficiencyBase?.personRows
    if (!persons?.length) return []
    return persons.map((r) => {
      const args = {
        sorterName: r.sorterName,
        sorterKey: r.sorterKey,
        efficiencyMatchNames: r.efficiencyMatchNames,
      }
      const scan = sortingScanCountForPerson(args, scannerResult)
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
  }, [attendanceEfficiencyBase, scannerResult])

  const scannerDailyAsTable = (scannerResult?.dailySummaryRows ?? []) as unknown as DataTableRow[]
  const allocationDensityAsTable = allocationDensityRows as unknown as DataTableRow[]
  const frontDeskClockOutAsTable = frontDeskClockOutRows as unknown as DataTableRow[]

  const scannerHourlyPivotTables = useMemo(
    () => buildScannerHourlyPivotTables(scannerResult?.scannerHourlyRows ?? []),
    [scannerResult?.scannerHourlyRows],
  )

  const scannerPersonAsTable = (scannerResult?.scannerTotalRows ?? []) as unknown as DataTableRow[]

  const scannerTotalEfficiencyRows = useMemo(
    () => buildScannerTotalEfficiencyRows(scannerResult, attendanceEfficiencyBase?.personRows),
    [scannerResult, attendanceEfficiencyBase?.personRows],
  )

  const scannerTotalEfficiencyAsTable = scannerTotalEfficiencyRows as unknown as DataTableRow[]

  const scannerDailyEfficiencyTrendPoints = useMemo(() => {
    const rows = scannerResult?.dailySummaryRows ?? []
    return rows.map((r) => ({ date: r.date, value: r.efficiency }))
  }, [scannerResult?.dailySummaryRows])

  const openDayRuleTooltipText = `当前规则：分拣人数 > ${settings.openDayThreshold} 计入开仓日；分拣人数 ≤ ${settings.openDayThreshold} 计入不开仓日。`

  const effectiveCancelScanAnalysis = useMemo(
    () => snapshotRestore?.cancelScanAnalysis ?? cancelScanAnalysis,
    [snapshotRestore?.cancelScanAnalysis, cancelScanAnalysis],
  )

  return {
    settings,
    scanSourceInfo,
    lastInboundApiStats,
    attendanceSourceInfo,
    allocationSourceInfo,
    loadingAllocationApi,
    loadingCancelScanAnalysis,
    cancelScanAnalysis: effectiveCancelScanAnalysis,
    loading,
    error,
    scannerHourlyExpanded,
    setScannerHourlyExpanded,
    efficiencyDetailDimension,
    handleEfficiencyDetailDimensionChange,
    efficiencyChartOpenDaysOnly,
    handleEfficiencyChartOpenDaysOnlyChange,
    efficiencyDetailExpandedWeekKeys,
    handleEfficiencyDetailWeekRowClick,
    scanAggregate,
    attendanceResult,
    attendanceRows,
    scannerResult,
    allocationDensityRows,
    frontDeskClockOutRows,
    activeTab,
    setActiveTab,
    weeklyPanelKey,
    summaryMetrics,
    dailyVolumeColumns,
    attendanceMatchColumns,
    attendancePersonColumns,
    scannerDailyColumns,
    scannerPersonColumns,
    scannerTotalEfficiencyColumns,
    handleSettingChange,
    handleScanFileChange,
    handleScanApiFetch,
    handleAttendanceFileChange,
    handleAllocationFileChange,
    clearAttendance,
    clearAllocation,
    clearAll,
    hasScanData,
    dailyCostPerTicketByDate,
    dailyTotalLaborCostByDate,
    dailyLaborCostByDate,
    dailyRowsAsTable,
    dailyVolumeTrendPoints,
    attendanceDayEfficiencyBubbleData,
    attendanceDailyAsTable,
    attendanceWeeklyAsTable,
    attendancePersonAsTable,
    scannerDailyAsTable,
    allocationDensityAsTable,
    frontDeskClockOutAsTable,
    scannerHourlyPivotTables,
    scannerPersonAsTable,
    scannerTotalEfficiencyRows,
    scannerTotalEfficiencyAsTable,
    scannerDailyEfficiencyTrendPoints,
    openDayRuleTooltipText,
    snapshotRestore,
    dismissSnapshotRestore,
    canSaveDailyRecords,
    savingDailyRecords,
    handleSaveDailyRecords,
  }
}

export type ScannerEfficiencyViewModel = ReturnType<typeof useScannerEfficiencyPage>
