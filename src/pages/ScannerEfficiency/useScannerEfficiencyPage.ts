import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppSettings } from '../../context/AppSettingsContext'
import { PERMISSION_KEYS, usePermission } from '../../hooks/usePermission'
import {
  buildDailyLaborCostFromPayrollByDate,
  computeAttendancePayrollFromFiles,
  computeAttendancePayrollFromSheetRows,
  type AttendancePayrollResult,
} from '../../payroll/attendancePayrollFromUpload'
import {
  filterZktAttendanceSheetRowsByDateRange,
  mapZktTimeCardToAttendanceSheetRows,
} from '../../payroll/zktTimeCardSheetMapping'
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
import { fetchBoxAssignedList, fetchCancelScanAnalysis, fetchInboundScans, fetchZktAttendance, saveDailyEfficiencyRecords } from './scannerEfficiencyApi'
import { mapInboundRecordsToParsedScanRows } from './inboundScanMapper'
import { mapZktTimeCardRecordsToParsedAttendanceRows } from './mapZktAttendanceRecords'
import type { CancelScanAnalysisState } from './cancelScanAnalysisTypes'
import { buildZoneInboundScanTotals } from './cancelScanRouteZoneTable'
import { flushPaint } from './excelParseClient'
import { buildAllocationDensity, buildFrontDeskClockOutDays } from './frontDeskSaturation'
import {
  captureEfficiencyAttendanceDayRecords,
  normalizeEfficiencyAttendanceDayRecord,
  restoreEfficiencyAttendancePage,
  type EfficiencyAttendanceDayRecord,
  type EfficiencyAttendancePageRestore,
} from './dailyEfficiencyRecordSnapshot'
import type { SourceInfo } from './sourceInfo'
import { buildScannerTotalEfficiencyRows, sortingScanCountForPerson } from './sortingLookup'
import type { DataTableRow } from './components/ui'
import { i18n } from '../../i18n/index'
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
  const { imileToken, zktAttendance } = useAppSettings()
  const location = useLocation()
  const navigate = useNavigate()
  const [settings, setSettings] = useState<ScanSettings>(() => ({ ...DEFAULT_SETTINGS }))
  const [snapshotRestore, setSnapshotRestore] = useState<EfficiencyAttendancePageRestore | null>(null)
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

  const refreshAttendancePayroll = useCallback(async () => {
    if (lastAttendanceFilesRef.current.length) {
      const payroll = await computeAttendancePayrollFromFiles(
        lastAttendanceFilesRef.current,
        wageEmployees,
        rateSettingsForLabor,
      )
      setAttendancePayroll(payroll)
      return
    }
    if (lastZktSheetRowsRef.current.length) {
      const payroll = computeAttendancePayrollFromSheetRows(
        lastZktSheetRowsRef.current,
        wageEmployees,
        rateSettingsForLabor,
      )
      setAttendancePayroll(payroll)
      return
    }
    setAttendancePayroll(null)
  }, [wageEmployees, rateSettingsForLabor])

  useEffect(() => {
    void refreshAttendancePayroll()
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
  /** ZKT API 拉取的考勤表行，用于与上传文件互斥地重算总成本 */
  const lastZktSheetRowsRef = useRef<Record<string, unknown>[]>([])
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
  const [apiDateRange, setApiDateRange] = useState<[string, string] | null>(null)
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

  const showPushTab = usePermission(PERMISSION_KEYS.btnPushNotificationsWarehouseEfficiency)

  const activeTab = useMemo((): TabKey => {
    const hasAttendance = Boolean(attendanceEfficiencyBase)
    if (manualTab === TAB_KEYS.WEEKLY) return hasAttendance ? TAB_KEYS.WEEKLY : TAB_KEYS.FRONT_DESK
    if (manualTab === TAB_KEYS.PUSH) {
      if (!showPushTab || !hasAttendance) return TAB_KEYS.FRONT_DESK
      return TAB_KEYS.PUSH
    }
    if (manualTab === TAB_KEYS.CANCEL_SCAN) return TAB_KEYS.CANCEL_SCAN
    if (manualTab === TAB_KEYS.FRONT_DESK) return TAB_KEYS.FRONT_DESK
    // 一级分拣仅依赖到件扫描，不要求考勤
    if (manualTab === TAB_KEYS.SCANNER) return TAB_KEYS.SCANNER
    // 默认开仓 tab：无考勤时，有一级分拣则展示分拣员效率，否则回退包裹分配密度
    if (!hasAttendance) return scannerResult ? TAB_KEYS.SCANNER : TAB_KEYS.FRONT_DESK
    return manualTab
  }, [manualTab, attendanceEfficiencyBase, scannerResult, showPushTab])

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
        label: String(i18n.t('metrics.openEfficiency', { ns: 'scannerEfficiency' })),
        value: String(i18n.t('metrics.ticketsPerHour', { ns: 'scannerEfficiency', value: formatNumber(attendanceResult.summary.openEfficiency, 2) })),
        hint: String(i18n.t('metrics.openEffHint', { ns: 'scannerEfficiency', volume: formatInteger(attendanceResult.summary.uploadedVolume), hours: formatNumber(attendanceResult.summary.openHours, 2), share: formatCainiaoSharePercent(attendanceResult.summary.cainiaoShareOpenDays) })),
        tone: 'dark' as const,
      },
      {
        label: String(i18n.t('metrics.overallEfficiency', { ns: 'scannerEfficiency' })),
        value: String(i18n.t('metrics.ticketsPerHour', { ns: 'scannerEfficiency', value: formatNumber(attendanceResult.summary.overallEfficiency, 2) })),
        hint: String(i18n.t('metrics.overallEffHint', { ns: 'scannerEfficiency', volume: formatInteger(attendanceResult.summary.uploadedVolume), hours: formatNumber(attendanceResult.summary.allHours, 2), share: formatCainiaoSharePercent(attendanceResult.summary.cainiaoShareWindow) })),
      },
    ]
  }, [scanAggregate, attendanceResult, i18n.language])

  const scannerMetrics = useMemo(() => {
    if (!scanAggregate || !scannerResult) return null
    return [
      {
        label: String(i18n.t('metrics.sortingEfficiency', { ns: 'scannerEfficiency' })),
        value: String(i18n.t('metrics.ticketsPerHour', { ns: 'scannerEfficiency', value: formatNumber(scannerResult.summary.totalEfficiency, 2) })),
        hint: String(i18n.t('metrics.sortingEffHint', { ns: 'scannerEfficiency', scans: formatInteger(scannerResult.summary.totalScanCount), hours: formatNumber(scannerResult.summary.totalEffectiveHours, 2) })),
        tone: 'dark' as const,
      },
      {
        label: String(i18n.t('metrics.scannerCount', { ns: 'scannerEfficiency' })),
        value: formatInteger(scannerResult.summary.totalScanners),
        hint: String(i18n.t('metrics.scannerCountHint', { ns: 'scannerEfficiency' })),
      },
      {
        label: String(i18n.t('metrics.statDays', { ns: 'scannerEfficiency' })),
        value: formatInteger(scannerResult.summary.totalDays),
        hint: String(i18n.t('metrics.statDaysHint', { ns: 'scannerEfficiency' })),
      },
      {
        label: String(i18n.t('metrics.totalScanCount', { ns: 'scannerEfficiency' })),
        value: formatInteger(scannerResult.summary.totalScanCount),
        hint: String(i18n.t('metrics.totalScanHint', { ns: 'scannerEfficiency' })),
      },
    ]
  }, [scanAggregate, scannerResult, i18n.language])

  const summaryMetrics = useMemo(() => {
    if (activeTab === TAB_KEYS.WAREHOUSE) return warehouseMetrics ?? []
    if (activeTab === TAB_KEYS.SCANNER) return scannerMetrics ?? []
    return []
  }, [activeTab, warehouseMetrics, scannerMetrics])

  const dailyVolumeColumns = useMemo(() => buildDailyVolumeColumns(), [i18n.language])
  const attendanceMatchColumns = useMemo(
    () => buildAttendanceMatchColumns({ onDailyTotalHoursCommit: handleDailyTotalHoursCommit }),
    [handleDailyTotalHoursCommit, i18n.language],
  )
  const attendancePersonColumns = useMemo(
    () => buildAttendancePersonColumns(scannerResult),
    [scannerResult, i18n.language],
  )
  const scannerDailyColumns = useMemo(() => buildScannerDailyColumns(), [i18n.language])
  const scannerPersonColumns = useMemo(() => buildScannerPersonColumns(), [i18n.language])
  const scannerTotalEfficiencyColumns = useMemo(() => buildScannerTotalEfficiencyColumns(), [i18n.language])

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
    lastZktSheetRowsRef.current = []
    setAllocationRows([])
    setAllocationSourceInfo(EMPTY_SOURCE)
    setDailyHoursOverrides({})
    setCancelScanAnalysis(null)
    setError('')
  }, [])

  const applyDailyRecordRestore = useCallback((rawRecords: unknown[]) => {
    const records = rawRecords
      .map((item) => normalizeEfficiencyAttendanceDayRecord(item))
      .filter((item): item is EfficiencyAttendanceDayRecord => item != null)
    if (!records.length) {
      showToast(String(i18n.t('toast.recordUnavailable', { ns: 'scannerEfficiency' })), 'error')
      return
    }
    const restore = restoreEfficiencyAttendancePage(records)
    setSnapshotRestore(restore)
    setSettings((current) => ({ ...current, ...restore.settings }))
    setScanRows([])
    setAttendanceRows(restore.attendanceRows)
    setAllocationRows([])
    setScanSourceInfo(restore.scanSourceInfo)
    setAttendanceSourceInfo(restore.attendanceSourceInfo)
    setAllocationSourceInfo(restore.allocationSourceInfo)
    setAttendancePayroll(restore.attendancePayroll)
    lastAttendanceFilesRef.current = []
    lastZktSheetRowsRef.current = []
    setLastInboundApiStats(null)
    setDailyHoursOverrides({})
    setError('')
  }, [])

  useEffect(() => {
    const state = location.state as {
      restoreDailyRecord?: unknown
      restoreDailyRecords?: unknown[]
    } | null
    const rawRecords = state?.restoreDailyRecords?.length
      ? state.restoreDailyRecords
      : state?.restoreDailyRecord
        ? [state.restoreDailyRecord]
        : null
    if (!rawRecords?.length) return
    applyDailyRecordRestore(rawRecords)
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
      const records = captureEfficiencyAttendanceDayRecords({
        attendanceResult,
        attendanceRows,
        scannerResult,
        allocationDensityRows,
        frontDeskClockOutRows,
        cancelScanAnalysis,
        attendancePayroll,
        settings,
        scanSourceInfo,
        attendanceSourceInfo,
        allocationSourceInfo,
      })
      if (!records.length) {
        throw new Error(String(i18n.t('toast.noDailyRecords', { ns: 'scannerEfficiency' })))
      }
      const { savedCount } = await saveDailyEfficiencyRecords(records)
      showToast(String(i18n.t('toast.savedDailyRecords', { ns: 'scannerEfficiency', count: savedCount })), 'success')
    } catch (currentError: unknown) {
      const message = currentError instanceof Error ? currentError.message : String(i18n.t('toast.saveDailyFailed', { ns: 'scannerEfficiency' }))
      showToast(message, 'error')
    } finally {
      setSavingDailyRecords(false)
    }
  }, [
    allocationDensityRows,
    allocationSourceInfo,
    attendancePayroll,
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
            ? String(i18n.t('toast.inboundNoDatesAppend', { ns: 'scannerEfficiency' }))
            : String(i18n.t('toast.inboundNoDates', { ns: 'scannerEfficiency' })),
        )
      }

      const combinedRawRows = prevRows.length ? [...prevRows, ...parsed.rows] : parsed.rows
      const { rows: deduped, duplicateDropped } = dedupeParsedScanRowsByWaybill(combinedRawRows)
      if (!deduped.length) {
        throw new Error(String(i18n.t('toast.inboundNoRecordsAfterDedupe', { ns: 'scannerEfficiency' })))
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
      setError(currentError instanceof Error ? currentError.message : String(i18n.t('toast.inboundReadFailed', { ns: 'scannerEfficiency' })))
    } finally {
      setLoadingScan(false)
    }
  }

  const performAllocationFetch = async (token: string, startDate: string, endDate: string) => {
    setLoadingAllocationApi(true)
    try {
      const result = await fetchBoxAssignedList({
        imileToken: token,
        startDate,
        endDate,
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
            ? String(i18n.t('toast.allocationApiNoRecordsAppend', { ns: 'scannerEfficiency' }))
            : String(i18n.t('toast.allocationApiNoRecords', { ns: 'scannerEfficiency' })),
          'warning',
        )
        return
      }

      const combinedRawRows = prevRows.length ? [...prevRows, ...mapped.rows] : mapped.rows
      const { rows: deduped, duplicateDropped } = dedupeParsedAllocationRows(combinedRawRows)
      if (!deduped.length) {
        showToast(String(i18n.t('toast.allocationNoRecordsAfterDedupe', { ns: 'scannerEfficiency' })), 'warning')
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
        String(
          i18n.t('toast.allocationApiLoaded', {
            ns: 'scannerEfficiency',
            count: formatInteger(deduped.length),
            start: startDate,
            end: endDate,
          }),
        ),
        'success',
      )
    } catch (currentError: unknown) {
      const message =
        currentError instanceof Error ? currentError.message : String(i18n.t('toast.allocationApiFailed', { ns: 'scannerEfficiency' }))
      showToast(message, 'error')
    } finally {
      setLoadingAllocationApi(false)
    }
  }

  const handleAllocationApiFetch = async () => {
    const token = imileToken.trim()
    if (!token) {
      showToast(String(i18n.t('toast.missingImileToken', { ns: 'scannerEfficiency' })), 'error')
      return
    }
    if (!apiDateRange) {
      showToast(String(i18n.t('toast.selectDateRange', { ns: 'scannerEfficiency' })), 'error')
      return
    }
    void performAllocationFetch(token, apiDateRange[0], apiDateRange[1])
  }

  const performCancelScanFetch = async (token: string, startDate: string, endDate: string) => {
    setLoadingCancelScanAnalysis(true)
    try {
      const result = await fetchCancelScanAnalysis({
        imileToken: token,
        startDate,
        endDate,
      })

      console.group(`[ScannerEfficiency] 细分错误率分析 API 原始数据 ${startDate} ~ ${endDate}`)
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
        showToast(String(i18n.t('toast.cancelScanNoRecords', { ns: 'scannerEfficiency' })), 'warning')
        return
      }

      showToast(
        String(
          i18n.t('toast.cancelScanComplete', {
            ns: 'scannerEfficiency',
            records: formatInteger(result.meta.cancelScanFetched),
            routes: formatInteger(result.routeCodeDistribution.length),
          }),
        ),
        'success',
      )
    } catch (currentError: unknown) {
      const message =
        currentError instanceof Error ? currentError.message : String(i18n.t('toast.cancelScanFailed', { ns: 'scannerEfficiency' }))
      showToast(message, 'error')
    } finally {
      setLoadingCancelScanAnalysis(false)
    }
  }

  const handleCancelScanApiFetch = async () => {
    const token = imileToken.trim()
    if (!token) {
      showToast(String(i18n.t('toast.missingImileToken', { ns: 'scannerEfficiency' })), 'error')
      return
    }
    if (!apiDateRange) {
      showToast(String(i18n.t('toast.selectDateRange', { ns: 'scannerEfficiency' })), 'error')
      return
    }
    void performCancelScanFetch(token, apiDateRange[0], apiDateRange[1])
  }

  const performAttendanceApiFetch = async (
    startDate: string,
    endDate: string,
    options?: { replaceExisting?: boolean },
  ) => {
    const settings = zktAttendance
    if (!settings.username.trim() || !settings.password) {
      showToast(String(i18n.t('toast.zktCredentialsMissing', { ns: 'scannerEfficiency' })), 'warning')
      return
    }

    setLoadingAttendance(true)
    try {
      const result = await fetchZktAttendance({
        zktAttendance: settings,
        startDate,
        endDate,
      })

      if (result.count > 0 && result.meta.fetched < result.count) {
        throw new Error(String(i18n.t('toast.zktIncomplete', { ns: 'scannerEfficiency', count: result.count, fetched: result.meta.fetched })))
      }

      const sourceLabel = `ZKT 考勤 API（${startDate} ~ ${endDate}）`
      const mapped = mapZktTimeCardRecordsToParsedAttendanceRows(result.data, sourceLabel, {
        startDate,
        endDate,
      })
      const replaceExisting = options?.replaceExisting ?? false
      const prevRows = replaceExisting ? [] : attendanceRowsRef.current
      const prevSource = replaceExisting ? EMPTY_SOURCE : attendanceSourceInfoRef.current

      console.info('[ScannerEfficiency] ZKT 考勤 API 拉取完成', {
        dateRange: `${startDate} ~ ${endDate}`,
        query: result.meta.query ?? {
          start_date: startDate,
          end_date: endDate,
        },
        count: result.count,
        fetched: result.meta.fetched,
        replaceExisting,
        mappedRows: mapped.rows.length,
        mappedDropped: mapped.droppedRows,
      })

      if (!mapped.rows.length) {
        showToast(
          !replaceExisting && attendanceRowsRef.current.length
            ? String(i18n.t('toast.zktNoWorkedHrsAppend', { ns: 'scannerEfficiency', count: result.count }))
            : String(i18n.t('toast.zktNoWorkedHrs', { ns: 'scannerEfficiency', count: result.count })),
          'warning',
        )
        return
      }

      if (mapped.droppedRows > 0) {
        showToast(
          String(
            i18n.t('toast.zktLoaded', {
              ns: 'scannerEfficiency',
              rows: mapped.rows.length,
              count: result.count,
              dropped: mapped.droppedRows,
            }),
          ),
          mapped.droppedRows > mapped.rows.length ? 'warning' : 'success',
        )
      }

      const combinedRawRows = prevRows.length ? [...prevRows, ...mapped.rows] : mapped.rows
      const { rows: deduped, duplicateDropped } = dedupeParsedAttendanceRowsByPersonDay(combinedRawRows)
      if (!deduped.length) {
        showToast(String(i18n.t('toast.attendanceNoRecordsAfterDedupe', { ns: 'scannerEfficiency' })), 'warning')
        return
      }

      setAttendanceRows(deduped)
      const mergedNames = prevRows.length
        ? mergeOrderedUniqueFileNames(prevSource.fileNames, [sourceLabel])
        : [sourceLabel]

      setAttendanceSourceInfo({
        fileCount: mergedNames.length,
        rowCount: deduped.length,
        droppedRows: prevRows.length
          ? prevSource.droppedRows + mapped.droppedRows
          : mapped.droppedRows,
        duplicateWaybillRows: duplicateDropped,
        fileNames: mergedNames,
      })

      const fetchedSheetRows = filterZktAttendanceSheetRowsByDateRange(
        mapZktTimeCardToAttendanceSheetRows(result.data),
        startDate,
        endDate,
      )
      const mergedSheetRows = replaceExisting
        ? fetchedSheetRows
        : [...lastZktSheetRowsRef.current, ...fetchedSheetRows]
      lastZktSheetRowsRef.current = mergedSheetRows
      lastAttendanceFilesRef.current = []

      const payroll = computeAttendancePayrollFromSheetRows(
        mergedSheetRows,
        wageEmployees,
        rateSettingsForLabor,
      )
      setAttendancePayroll(payroll)
      if (payroll.validationErrors.length > 0) {
        setError(
          String(
            i18n.t('toast.payrollValidation', {
              ns: 'scannerEfficiency',
              valid: payroll.wageRows.length,
              invalid: payroll.validationErrors.length,
            }),
          ),
        )
      }
    } catch (currentError: unknown) {
      const message =
        currentError instanceof Error ? currentError.message : String(i18n.t('toast.zktFailed', { ns: 'scannerEfficiency' }))
      showToast(message, 'error')
    } finally {
      setLoadingAttendance(false)
    }
  }

  const handleScanApiFetch = async (startDate: string, endDate: string) => {
    const token = imileToken.trim()
    if (!token) {
      setError(String(i18n.t('toast.missingImileToken', { ns: 'scannerEfficiency' })))
      return
    }
    if (!startDate || !endDate) {
      setError(String(i18n.t('toast.invalidDateRange', { ns: 'scannerEfficiency' })))
      return
    }

    setApiDateRange([startDate, endDate])
    clearSnapshotRestore()
    setLoadingScan(true)
    setError('')
    await flushPaint()

    const attendancePromise = performAttendanceApiFetch(startDate, endDate, { replaceExisting: true })

    try {
      const result = await fetchInboundScans({
        imileToken: token,
        startDate,
        endDate,
      })

      console.group(`[ScannerEfficiency] iMile 到件 API 原始数据 ${startDate} ~ ${endDate}`)
      console.log('records（resultObject.results，未裁剪）', result.records)
      console.log('raw（完整分页 HTTP JSON）', result.raw)
      console.groupEnd()

      const sourceLabel = `iMile 到件 API（${startDate} ~ ${endDate}）`
      const mapped = mapInboundRecordsToParsedScanRows(result.records, sourceLabel)

      console.info('[ScannerEfficiency] iMile 到件 API 拉取完成', {
        dateRange: `${startDate} ~ ${endDate}`,
        apiTotalResult: result.meta.totalResult,
        apiFetched: result.records.length,
        mappedRows: mapped.rows.length,
        mappedDropped: mapped.droppedRows,
        sortingEligible: mapped.sortingEligibleCount,
      })

      if (!mapped.rows.length) {
        throw new Error(String(i18n.t('toast.inboundApiNoRecords', { ns: 'scannerEfficiency' })))
      }

      const { rows: deduped, duplicateDropped } = dedupeParsedScanRowsByWaybill(mapped.rows)
      if (!deduped.length) {
        throw new Error(String(i18n.t('toast.inboundNoRecordsAfterDedupe', { ns: 'scannerEfficiency' })))
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
      setScanSourceInfo({
        fileCount: 1,
        rowCount: deduped.length,
        droppedRows: mapped.droppedRows,
        duplicateWaybillRows: duplicateDropped,
        fileNames: [sourceLabel],
      })
    } catch (currentError: unknown) {
      setError(currentError instanceof Error ? currentError.message : String(i18n.t('toast.inboundApiFailed', { ns: 'scannerEfficiency' })))
    } finally {
      setLoadingScan(false)
      await attendancePromise
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
            ? String(i18n.t('toast.attendanceNoHoursAppend', { ns: 'scannerEfficiency' }))
            : String(i18n.t('toast.attendanceNoHours', { ns: 'scannerEfficiency' })),
        )
      }

      const combinedRawRows = prevRows.length ? [...prevRows, ...parsed.rows] : parsed.rows
      const { rows: deduped, duplicateDropped } = dedupeParsedAttendanceRowsByPersonDay(combinedRawRows)
      if (!deduped.length) {
        throw new Error(String(i18n.t('toast.attendanceNoRecordsAfterDedupe', { ns: 'scannerEfficiency' })))
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
      lastZktSheetRowsRef.current = []
      const payroll = await computeAttendancePayrollFromFiles(
        mergedFiles,
        wageEmployees,
        rateSettingsForLabor,
      )
      setAttendancePayroll(payroll)
      if (payroll.validationErrors.length > 0) {
        setError(
          String(
            i18n.t('toast.payrollValidation', {
              ns: 'scannerEfficiency',
              valid: payroll.wageRows.length,
              invalid: payroll.validationErrors.length,
            }),
          ),
        )
      }
    } catch (currentError: unknown) {
      setError(currentError instanceof Error ? currentError.message : String(i18n.t('toast.attendanceReadFailed', { ns: 'scannerEfficiency' })))
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
        throw new Error(String(i18n.t('toast.allocationNoTime', { ns: 'scannerEfficiency' })))
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
      setError(currentError instanceof Error ? currentError.message : String(i18n.t('toast.allocationReadFailed', { ns: 'scannerEfficiency' })))
    } finally {
      setLoadingAllocation(false)
    }
  }

  const clearAttendance = () => {
    setAttendanceRows([])
    setAttendanceSourceInfo(EMPTY_SOURCE)
    setAttendancePayroll(null)
    lastAttendanceFilesRef.current = []
    lastZktSheetRowsRef.current = []
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
    lastZktSheetRowsRef.current = []
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
        date: String(i18n.t('tableFooter.grandTotal', { ns: 'scannerEfficiency' })),
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

  const openDayRuleTooltipText = String(i18n.t('common.openDayRuleTooltip', { ns: 'scannerEfficiency', threshold: settings.openDayThreshold }))

  const effectiveCancelScanAnalysis = useMemo(
    () => snapshotRestore?.cancelScanAnalysis ?? cancelScanAnalysis,
    [snapshotRestore?.cancelScanAnalysis, cancelScanAnalysis],
  )

  const zoneInboundScanTotals = useMemo(() => {
    if (!scanRows.length || !effectiveCancelScanAnalysis) return null
    const { startDate, endDate } = effectiveCancelScanAnalysis.meta
    const totals = buildZoneInboundScanTotals(scanRows, startDate, endDate)
    return totals.size > 0 ? totals : null
  }, [scanRows, effectiveCancelScanAnalysis])

  return {
    settings,
    scanSourceInfo,
    lastInboundApiStats,
    attendanceSourceInfo,
    allocationSourceInfo,
    loadingAllocationApi,
    loadingCancelScanAnalysis,
    cancelScanAnalysis: effectiveCancelScanAnalysis,
    zoneInboundScanTotals,
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
    showPushTab,
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
    handleCancelScanApiFetch,
    handleAllocationApiFetch,
    apiDateRange,
    setApiDateRange,
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
