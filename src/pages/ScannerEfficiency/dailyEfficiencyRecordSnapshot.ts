import { i18n } from '../../i18n/index'
import type { AttendancePayrollResult } from '../../payroll/attendancePayrollFromUpload'
import type {
  AttendanceEfficiencyResult,
  ParsedAttendanceRow,
  ScannerEfficiencyResult,
  ScanAggregate,
} from './aggregates'
import type { ScanSettings } from './constants'
import type { FrontDeskClockOutDayRow, FrontDeskDensityRow } from './frontDeskSaturation'
import type { SourceInfo } from './sourceInfo'
import type { CancelScanAnalysisState } from './cancelScanAnalysisTypes'

/** 效率考勤按日存档 schema 版本（当前写入 v2） */
export const EFFICIENCY_ATTENDANCE_DAY_RECORD_SCHEMA_VERSION = 2 as const

/** @deprecated 使用 EFFICIENCY_ATTENDANCE_DAY_RECORD_SCHEMA_VERSION */
export const DAILY_EFFICIENCY_RECORD_SCHEMA_VERSION = EFFICIENCY_ATTENDANCE_DAY_RECORD_SCHEMA_VERSION

export type EfficiencyAttendanceComputationSettings = Pick<
  ScanSettings,
  | 'openDayThreshold'
  | 'breakCapMinutes'
  | 'splitThresholdMinutes'
  | 'minSingleScanSessionMinutes'
>

/** @deprecated 使用 EfficiencyAttendanceComputationSettings */
export type DailyEfficiencyRecordSettings = EfficiencyAttendanceComputationSettings

export type EfficiencyAttendancePersonDayRow = Pick<
  ParsedAttendanceRow,
  | 'date'
  | 'sorterKey'
  | 'sorterName'
  | 'nameNick'
  | 'nameFull'
  | 'hours'
  | 'isFrontDesk'
  | 'isSorterWorker'
  | 'positionTitle'
>

/** @deprecated 使用 EfficiencyAttendancePersonDayRow */
export type DailyEfficiencyPersonDayRow = EfficiencyAttendancePersonDayRow

export type EfficiencyAttendanceWarehouseData = {
  /** 当日仓库效率汇总行（货量、工时、效率等） */
  daily: AttendanceEfficiencyResult['dailyRows'][number]
  /** 当日考勤明细（还原 attendanceRows 的唯一来源） */
  personDayRows: EfficiencyAttendancePersonDayRow[]
}

/** @deprecated 使用 EfficiencyAttendanceWarehouseData */
export type DailyEfficiencyWarehouseSlice = EfficiencyAttendanceWarehouseData & {
  personRows?: AttendanceEfficiencyResult['personRows']
}

export type EfficiencyAttendanceScannerData = {
  dailySummaryRow: ScannerEfficiencyResult['dailySummaryRows'][number] | null
  dailyScannerRows: ScannerEfficiencyResult['dailyScannerRows']
  scannerHourlyRows: ScannerEfficiencyResult['scannerHourlyRows']
  scannerTotalRows: ScannerEfficiencyResult['scannerTotalRows']
  summary: ScannerEfficiencyResult['summary']
}

/** @deprecated 使用 EfficiencyAttendanceScannerData */
export type DailyEfficiencyScannerSlice = EfficiencyAttendanceScannerData

export type EfficiencyAttendanceFrontDeskData = {
  densityRows: FrontDeskDensityRow[]
  clockOut: FrontDeskClockOutDayRow | null
}

/** @deprecated 使用 EfficiencyAttendanceFrontDeskData */
export type DailyEfficiencyFrontDeskSlice = EfficiencyAttendanceFrontDeskData

export type EfficiencyAttendancePayrollData = {
  /** 当日人工总成本（工资结算同款口径） */
  totalLaborCost: number
}

/** @deprecated 使用 EfficiencyAttendancePayrollData */
export type DailyEfficiencyLaborCostSlice = EfficiencyAttendancePayrollData

export type EfficiencyAttendanceProvenance = {
  scan: SourceInfo
  attendance: SourceInfo
  allocation: SourceInfo
}

/**
 * 效率考勤按日存档 — 页面「查看/回填」的唯一数据模型。
 * 按自然日一条记录入库；多日查看时由 restore 层合并。
 */
export type EfficiencyAttendanceDayRecord = {
  schemaVersion: typeof EFFICIENCY_ATTENDANCE_DAY_RECORD_SCHEMA_VERSION
  date: string
  computation: EfficiencyAttendanceComputationSettings
  provenance: EfficiencyAttendanceProvenance
  warehouse: EfficiencyAttendanceWarehouseData
  scanner: EfficiencyAttendanceScannerData | null
  frontDesk: EfficiencyAttendanceFrontDeskData | null
  payroll: EfficiencyAttendancePayrollData | null
  cancelScanAnalysis: CancelScanAnalysisState | null
}

/** @deprecated 使用 EfficiencyAttendanceDayRecord */
export type DailyEfficiencyRecordPayload = EfficiencyAttendanceDayRecord

/**
 * 存档日的类型：
 * - full：有到件也有考勤，正常统计日
 * - attendanceOnly：有考勤无到件（无到件补录日），只贡献工时分母
 * - scanOnly：有到件无考勤，只贡献货量分子
 */
export type EfficiencyAttendanceDayKind = 'full' | 'attendanceOnly' | 'scanOnly'

export function resolveEfficiencyAttendanceDayKind(
  daily: AttendanceEfficiencyResult['dailyRows'][number],
): EfficiencyAttendanceDayKind {
  if (!daily.hasAttendance) return 'scanOnly'
  if (daily.isAttendanceOnly) return 'attendanceOnly'
  return 'full'
}

export type EfficiencyAttendanceDayRecordListItem = {
  date: string
  kind: EfficiencyAttendanceDayKind
  updatedAt: string
  volume: number | null
  dayEfficiency: number | null
  openEfficiency: number | null
  overallEfficiency: number | null
  sortingEfficiency: number | null
  hasFrontDesk: boolean
  totalLaborCost: number | null
  costPerTicket: number | null
}

/** @deprecated 使用 EfficiencyAttendanceDayRecordListItem */
export type DailyEfficiencyRecordListItem = EfficiencyAttendanceDayRecordListItem

/** 活页保存时的完整输入 — 所有域从同一对象采集，避免遗漏 */
export type EfficiencyAttendancePageCaptureInput = {
  attendanceResult: AttendanceEfficiencyResult
  attendanceRows: ParsedAttendanceRow[]
  scannerResult: ScannerEfficiencyResult | null
  allocationDensityRows: FrontDeskDensityRow[]
  frontDeskClockOutRows: FrontDeskClockOutDayRow[]
  cancelScanAnalysis: CancelScanAnalysisState | null
  attendancePayroll: AttendancePayrollResult | null
  settings: ScanSettings
  scanSourceInfo: SourceInfo
  attendanceSourceInfo: SourceInfo
  allocationSourceInfo: SourceInfo
}

/** 存档还原后注入效率考勤页的只读态 */
export type EfficiencyAttendancePageRestore = {
  settings: EfficiencyAttendanceComputationSettings
  scanAggregate: ScanAggregate
  attendanceResult: AttendanceEfficiencyResult
  attendanceRows: ParsedAttendanceRow[]
  scannerResult: ScannerEfficiencyResult | null
  allocationDensityRows: FrontDeskDensityRow[]
  frontDeskClockOutRows: FrontDeskClockOutDayRow[]
  scanSourceInfo: SourceInfo
  attendanceSourceInfo: SourceInfo
  allocationSourceInfo: SourceInfo
  attendancePayroll: AttendancePayrollResult | null
  cancelScanAnalysis: CancelScanAnalysisState | null
  restoredDate: string
  restoredDates: string[]
}

/** @deprecated 使用 EfficiencyAttendancePageRestore */
export type DailyEfficiencyRestoreState = EfficiencyAttendancePageRestore

const SCANNER_RELIABILITY_BASE_SCAN_COUNT = 1100
const SCANNER_RELIABILITY_BASE_EFFECTIVE_HOURS = 2.35
/** 与 aggregates.ts 保持一致：菜鸟件相对普通件的分拣难度比率 */
const CAINIAO_DIFFICULTY_RATIO = 0.7

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isDateInInclusiveRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

function pickComputationSettings(settings: ScanSettings): EfficiencyAttendanceComputationSettings {
  return {
    openDayThreshold: settings.openDayThreshold,
    breakCapMinutes: settings.breakCapMinutes,
    splitThresholdMinutes: settings.splitThresholdMinutes,
    minSingleScanSessionMinutes: settings.minSingleScanSessionMinutes,
  }
}

function resolveCancelScanForDate(
  date: string,
  cancelScanAnalysis: CancelScanAnalysisState | null | undefined,
): CancelScanAnalysisState | null {
  if (!cancelScanAnalysis) return null
  const { startDate, endDate } = cancelScanAnalysis.meta
  if (!isDateInInclusiveRange(date, startDate, endDate)) return null
  return cancelScanAnalysis
}

function resolvePayrollForDate(
  date: string,
  attendancePayroll: AttendancePayrollResult | null | undefined,
): EfficiencyAttendancePayrollData | null {
  const totalLaborCost = attendancePayroll?.wagesByDate[date]
  if (totalLaborCost == null || !Number.isFinite(totalLaborCost)) return null
  return { totalLaborCost }
}

function buildScannerTotalRowsForDay(
  dailyScannerRows: ScannerEfficiencyResult['dailyScannerRows'],
  windowTotalEfficiency: number,
): ScannerEfficiencyResult['scannerTotalRows'] {
  const byScanner = new Map<
    string,
    {
      scanner: string
      scanCount: number
      cainiaoScanCount: number
      effectiveMinutes: number
      activeDateSet: Set<string>
    }
  >()

  for (const row of dailyScannerRows) {
    if (!byScanner.has(row.scanner)) {
      byScanner.set(row.scanner, {
        scanner: row.scanner,
        scanCount: 0,
        cainiaoScanCount: 0,
        effectiveMinutes: 0,
        activeDateSet: new Set(),
      })
    }
    const item = byScanner.get(row.scanner)!
    item.scanCount += row.scanCount
    item.cainiaoScanCount += row.cainiaoScanCount ?? 0
    item.effectiveMinutes += row.effectiveMinutes
    item.activeDateSet.add(row.date)
  }

  let totalScanCountAll = 0
  let totalCainiaoCountAll = 0
  byScanner.forEach((item) => {
    totalScanCountAll += item.scanCount
    totalCainiaoCountAll += item.cainiaoScanCount
  })
  const cainiaoShareTeam = totalScanCountAll > 0 ? totalCainiaoCountAll / totalScanCountAll : 0
  const difficultyTeam = 1 - (1 - CAINIAO_DIFFICULTY_RATIO) * cainiaoShareTeam

  return Array.from(byScanner.values())
    .map((item) => {
      const effectiveHours = item.effectiveMinutes / 60
      const activeDays = item.activeDateSet.size
      const efficiency = effectiveHours > 0 ? item.scanCount / effectiveHours : 0
      const scanWeight = Math.min(item.scanCount / SCANNER_RELIABILITY_BASE_SCAN_COUNT, 1)
      const avgDailyEffectiveHours = activeDays > 0 ? effectiveHours / activeDays : 0
      const hourWeight = Math.min(avgDailyEffectiveHours / SCANNER_RELIABILITY_BASE_EFFECTIVE_HOURS, 1)
      const reliabilityWeight = scanWeight * hourWeight
      const adjustedEfficiency = efficiency * reliabilityWeight + windowTotalEfficiency * (1 - reliabilityWeight)

      const cainiaoScanCount = item.cainiaoScanCount
      const cainiaoShare = item.scanCount > 0 ? cainiaoScanCount / item.scanCount : 0
      const difficultyI = 1 - (1 - CAINIAO_DIFFICULTY_RATIO) * cainiaoShare
      const rawFactor = difficultyTeam > 0 ? difficultyI / difficultyTeam : 1
      const cainiaoCorrectionFactor = Math.max(0.80, Math.min(1.20, rawFactor))
      const cainiaoAdjustedEfficiency = adjustedEfficiency * cainiaoCorrectionFactor

      return {
        scanner: item.scanner,
        scanCount: item.scanCount,
        cainiaoScanCount,
        cainiaoShare,
        cainiaoCorrectionFactor,
        activeDays,
        effectiveHours,
        efficiency,
        reliabilityWeight,
        adjustedEfficiency,
        cainiaoAdjustedEfficiency,
      }
    })
    .sort((a, b) => b.cainiaoAdjustedEfficiency - a.cainiaoAdjustedEfficiency)
}

function buildScannerDataForDate(
  scannerResult: ScannerEfficiencyResult | null,
  date: string,
): EfficiencyAttendanceScannerData | null {
  if (!scannerResult) return null

  const dailyScannerRows = scannerResult.dailyScannerRows.filter((row) => row.date === date)
  const scannerHourlyRows = scannerResult.scannerHourlyRows.filter((row) => row.date === date)
  const dailySummaryRow = scannerResult.dailySummaryRows.find((row) => row.date === date) ?? null

  if (!dailyScannerRows.length && !dailySummaryRow && !scannerHourlyRows.length) {
    return null
  }

  const totalScanCount = dailySummaryRow?.scanCount ?? dailyScannerRows.reduce((sum, row) => sum + row.scanCount, 0)
  const totalEffectiveHours =
    dailySummaryRow?.effectiveHours ??
    dailyScannerRows.reduce((sum, row) => sum + row.effectiveHours, 0)
  const totalEfficiency =
    dailySummaryRow?.efficiency ??
    (totalEffectiveHours > 0 ? totalScanCount / totalEffectiveHours : 0)
  const scannerTotalRows = buildScannerTotalRowsForDay(dailyScannerRows, totalEfficiency)

  return {
    dailySummaryRow:
      dailySummaryRow ??
      (totalScanCount > 0
        ? {
            date,
            scanCount: totalScanCount,
            scannerCount: new Set(dailyScannerRows.map((row) => row.scanner)).size,
            effectiveHours: totalEffectiveHours,
            efficiency: totalEfficiency,
          }
        : null),
    dailyScannerRows,
    scannerHourlyRows,
    scannerTotalRows,
    summary: {
      totalScanCount,
      totalEffectiveHours,
      totalEfficiency,
      totalDays: dailySummaryRow || dailyScannerRows.length ? 1 : 0,
      totalScanners: scannerTotalRows.length,
    },
  }
}

function personDayRowsToAttendanceRows(personDayRows: EfficiencyAttendancePersonDayRow[]): ParsedAttendanceRow[] {
  return personDayRows.map((row) => ({
    ...row,
    positionCode: undefined,
    clockInTime: null,
    clockOutTime: null,
    workday: undefined,
    surname: undefined,
    sourceFileName: String(i18n.t('snapshot.sourceFileName', { ns: 'scannerEfficiency' })),
    sourceSheetName: '',
    sourceRowNumber: 0,
  }))
}

function buildAttendancePayrollFromRecords(
  records: EfficiencyAttendanceDayRecord[],
): AttendancePayrollResult | null {
  const wagesByDate: Record<string, number> = {}
  let totalWages = 0
  let hasAny = false

  for (const record of records) {
    const totalLaborCost = record.payroll?.totalLaborCost
    if (totalLaborCost == null || !Number.isFinite(totalLaborCost)) continue
    hasAny = true
    wagesByDate[record.date] = totalLaborCost
    totalWages += totalLaborCost
  }

  if (!hasAny) return null

  return {
    wageRows: [],
    totalWages,
    wagesByDate,
    validationErrors: [],
  }
}

function mergeCancelScanAnalysis(records: EfficiencyAttendanceDayRecord[]): CancelScanAnalysisState | null {
  const slices = records
    .map((record) => record.cancelScanAnalysis)
    .filter((item): item is CancelScanAnalysisState => item != null)
  if (!slices.length) return null

  const byRange = new Map<string, CancelScanAnalysisState>()
  for (const slice of slices) {
    const key = `${slice.meta.startDate}~${slice.meta.endDate}`
    if (!byRange.has(key)) byRange.set(key, slice)
  }
  if (byRange.size === 1) return [...byRange.values()][0]!

  return [...byRange.values()].sort((a, b) => {
    const endCmp = b.meta.endDate.localeCompare(a.meta.endDate)
    if (endCmp !== 0) return endCmp
    return b.meta.waybillFetched - a.meta.waybillFetched
  })[0]!
}

function mergePersonRowsFromRecords(
  records: EfficiencyAttendanceDayRecord[],
): AttendanceEfficiencyResult['personRows'] {
  const map = new Map<
    string,
    {
      sorterKey: string
      sorterName: string
      totalHours: number
      activeDateSet: Set<string>
      openDaySet: Set<string>
      matchNames: Set<string>
      seenPersonDays: Set<string>
    }
  >()

  for (const record of records) {
    const isOpenDay = record.warehouse.daily.isOpenDay
    for (const row of record.warehouse.personDayRows) {
      const personDayKey = `${row.sorterKey}\0${row.date}`
      if (!map.has(row.sorterKey)) {
        map.set(row.sorterKey, {
          sorterKey: row.sorterKey,
          sorterName: row.sorterName || row.sorterKey,
          totalHours: 0,
          activeDateSet: new Set(),
          openDaySet: new Set(),
          matchNames: new Set(),
          seenPersonDays: new Set(),
        })
      }
      const person = map.get(row.sorterKey)!
      if (!person.seenPersonDays.has(personDayKey)) {
        person.seenPersonDays.add(personDayKey)
        person.totalHours += row.hours
        person.activeDateSet.add(row.date)
        if (isOpenDay) person.openDaySet.add(row.date)
      }
      ;[row.sorterName, row.sorterKey, row.nameNick, row.nameFull].forEach((label) => {
        const text = String(label ?? '').trim()
        if (text) person.matchNames.add(text)
      })
    }
  }

  return Array.from(map.values())
    .map((person) => ({
      sorterKey: person.sorterKey,
      sorterName: person.sorterName,
      totalHours: person.totalHours,
      activeDays: person.activeDateSet.size,
      openDays: person.openDaySet.size,
      efficiencyMatchNames: Array.from(person.matchNames),
    }))
    .sort((a, b) => b.totalHours - a.totalHours)
}

function mergeScannerData(records: EfficiencyAttendanceDayRecord[]): ScannerEfficiencyResult | null {
  const slices = records.map((record) => record.scanner).filter(Boolean) as EfficiencyAttendanceScannerData[]
  if (!slices.length) return null

  const dailyScannerRows = slices.flatMap((slice) => slice.dailyScannerRows)
  const scannerHourlyRows = slices.flatMap((slice) => slice.scannerHourlyRows)
  const dailySummaryRows = slices
    .map((slice) => slice.dailySummaryRow)
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => a.date.localeCompare(b.date))

  const totalScanCount = dailySummaryRows.reduce((sum, row) => sum + row.scanCount, 0)
  const totalEffectiveHours = dailySummaryRows.reduce((sum, row) => sum + row.effectiveHours, 0)
  const totalEfficiency = totalEffectiveHours > 0 ? totalScanCount / totalEffectiveHours : 0
  const scannerTotalRows = buildScannerTotalRowsForDay(dailyScannerRows, totalEfficiency)

  return {
    dailyScannerRows: dailyScannerRows.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return b.scanCount - a.scanCount
    }),
    scannerHourlyRows,
    dailySummaryRows,
    scannerTotalRows,
    summary: {
      totalScanCount,
      totalEffectiveHours,
      totalEfficiency,
      totalDays: dailySummaryRows.length,
      totalScanners: scannerTotalRows.length,
    },
  }
}

function mergeSourceInfo(items: SourceInfo[], label: string): SourceInfo {
  if (items.length === 1) return items[0]!
  const fileNames = Array.from(new Set(items.flatMap((item) => item.fileNames)))
  return {
    fileCount: fileNames.length,
    rowCount: items.reduce((sum, item) => sum + item.rowCount, 0),
    droppedRows: items.reduce((sum, item) => sum + item.droppedRows, 0),
    duplicateWaybillRows: items.reduce((sum, item) => sum + (item.duplicateWaybillRows ?? 0), 0),
    fileNames: fileNames.length ? fileNames : [label],
  }
}

function parseDateKeyToUtcMs(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function isContiguousDateKeys(dates: string[]): boolean {
  if (dates.length <= 1) return true
  const sorted = [...dates].sort((a, b) => a.localeCompare(b))
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = parseDateKeyToUtcMs(sorted[i - 1]!)
    const curr = parseDateKeyToUtcMs(sorted[i]!)
    if (curr - prev !== 86_400_000) return false
  }
  return true
}

function formatRestoredDateLabel(dates: string[]): string {
  if (!dates.length) return ''
  const sorted = [...dates].sort((a, b) => a.localeCompare(b))
  if (sorted.length === 1) return sorted[0]!
  if (isContiguousDateKeys(sorted)) {
    return `${sorted[0]} ~ ${sorted[sorted.length - 1]}`
  }
  if (sorted.length <= 4) {
    return String(
      i18n.t('snapshot.dateRangeShort', {
        ns: 'scannerEfficiency',
        count: sorted.length,
        dates: sorted.join(String(i18n.t('common.listSeparator', { ns: 'scannerEfficiency' })).trim() || '、'),
      }),
    )
  }
  return String(
    i18n.t('snapshot.dateRangeEllipsis', {
      ns: 'scannerEfficiency',
      count: sorted.length,
      first: sorted[0],
      last: sorted[sorted.length - 1],
    }),
  )
}

function readSourceInfo(raw: unknown): SourceInfo | null {
  if (!isRecord(raw)) return null
  const fileNames = Array.isArray(raw.fileNames)
    ? raw.fileNames.map((item) => String(item)).filter(Boolean)
    : []
  return {
    fileCount: Number(raw.fileCount) || fileNames.length,
    rowCount: Number(raw.rowCount) || 0,
    droppedRows: Number(raw.droppedRows) || 0,
    duplicateWaybillRows: Number(raw.duplicateWaybillRows) || 0,
    fileNames,
  }
}

function readLegacyWarehouse(raw: unknown): EfficiencyAttendanceWarehouseData | null {
  if (!isRecord(raw)) return null
  const daily = raw.daily
  if (!isRecord(daily) || typeof daily.date !== 'string') return null

  const personDayRows = Array.isArray(raw.personDayRows)
    ? (raw.personDayRows as EfficiencyAttendancePersonDayRow[])
    : []

  return {
    daily: daily as AttendanceEfficiencyResult['dailyRows'][number],
    personDayRows,
  }
}

function readLegacyPayroll(raw: unknown): EfficiencyAttendancePayrollData | null {
  if (!isRecord(raw)) return null
  const totalLaborCost = Number(raw.totalLaborCost)
  if (!Number.isFinite(totalLaborCost)) return null
  return { totalLaborCost }
}

/** 将 DB 中的 v1/v2 payload 规范化为 v2 存档模型 */
export function normalizeEfficiencyAttendanceDayRecord(raw: unknown): EfficiencyAttendanceDayRecord | null {
  if (!isRecord(raw)) return null
  const date = typeof raw.date === 'string' ? raw.date.trim() : ''
  if (!date) return null

  const schemaVersion = Number(raw.schemaVersion)

  if (schemaVersion === EFFICIENCY_ATTENDANCE_DAY_RECORD_SCHEMA_VERSION) {
    const warehouse = readLegacyWarehouse(raw.warehouse)
    if (!warehouse) return null
    const computation = isRecord(raw.computation)
      ? (raw.computation as EfficiencyAttendanceComputationSettings)
      : null
    const provenanceRaw = isRecord(raw.provenance) ? raw.provenance : null
    if (!computation || !provenanceRaw) return null

    const scan = readSourceInfo(provenanceRaw.scan)
    const attendance = readSourceInfo(provenanceRaw.attendance)
    const allocation = readSourceInfo(provenanceRaw.allocation)
    if (!scan || !attendance || !allocation) return null

    return {
      schemaVersion: EFFICIENCY_ATTENDANCE_DAY_RECORD_SCHEMA_VERSION,
      date,
      computation,
      provenance: { scan, attendance, allocation },
      warehouse,
      scanner: (raw.scanner as EfficiencyAttendanceScannerData | null) ?? null,
      frontDesk: (raw.frontDesk as EfficiencyAttendanceFrontDeskData | null) ?? null,
      payroll: readLegacyPayroll(raw.payroll),
      cancelScanAnalysis: (raw.cancelScanAnalysis as CancelScanAnalysisState | null) ?? null,
    }
  }

  if (schemaVersion === 1) {
    const warehouseRaw = raw.warehouse
    const warehouse = readLegacyWarehouse(warehouseRaw)
    if (!warehouse) return null

    const settings = isRecord(raw.settings)
      ? (raw.settings as EfficiencyAttendanceComputationSettings)
      : null
    const source = isRecord(raw.source) ? raw.source : null
    if (!settings || !source) return null

    const scan = readSourceInfo(source.scanSourceInfo)
    const attendance = readSourceInfo(source.attendanceSourceInfo)
    const allocation = readSourceInfo(source.allocationSourceInfo)
    if (!scan || !attendance || !allocation) return null

    const payroll =
      readLegacyPayroll(raw.payroll) ??
      readLegacyPayroll(raw.laborCost)

    return {
      schemaVersion: EFFICIENCY_ATTENDANCE_DAY_RECORD_SCHEMA_VERSION,
      date,
      computation: settings,
      provenance: { scan, attendance, allocation },
      warehouse,
      scanner: (raw.scanner as EfficiencyAttendanceScannerData | null) ?? null,
      frontDesk: (raw.frontDesk as EfficiencyAttendanceFrontDeskData | null) ?? null,
      payroll,
      cancelScanAnalysis: (raw.cancelScanAnalysis as CancelScanAnalysisState | null) ?? null,
    }
  }

  return null
}

/** 从效率考勤活页状态采集按日存档（保存入口） */
export function captureEfficiencyAttendanceDayRecords(
  input: EfficiencyAttendancePageCaptureInput,
): EfficiencyAttendanceDayRecord[] {
  const {
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
  } = input

  const computation = pickComputationSettings(settings)
  const provenance: EfficiencyAttendanceProvenance = {
    scan: scanSourceInfo,
    attendance: attendanceSourceInfo,
    allocation: allocationSourceInfo,
  }

  // 存档必须覆盖窗口内的每一天：仅考勤日（无到件）的工时进「总体/开仓效率」分母，
  // 无考勤日的货量进分子。漏存任何一类，回填口径都会和实时计算对不上。
  const dates = attendanceResult.dailyRows
    .map((row) => row.date)
    .sort((a, b) => a.localeCompare(b))

  return dates.map((date) => {
    const daily = attendanceResult.dailyRows.find((row) => row.date === date)!
    const personDayRows = attendanceRows
      .filter((row) => row.date === date)
      .map(
        (row): EfficiencyAttendancePersonDayRow => ({
          date: row.date,
          sorterKey: row.sorterKey,
          sorterName: row.sorterName,
          nameNick: row.nameNick,
          nameFull: row.nameFull,
          hours: row.hours,
          isFrontDesk: row.isFrontDesk,
          isSorterWorker: row.isSorterWorker,
          positionTitle: row.positionTitle,
        }),
      )

    return {
      schemaVersion: EFFICIENCY_ATTENDANCE_DAY_RECORD_SCHEMA_VERSION,
      date,
      computation,
      provenance,
      warehouse: { daily, personDayRows },
      scanner: buildScannerDataForDate(scannerResult, date),
      frontDesk: {
        densityRows: allocationDensityRows.filter((row) => row.date === date),
        clockOut: frontDeskClockOutRows.find((row) => row.date === date) ?? null,
      },
      payroll: resolvePayrollForDate(date, attendancePayroll),
      cancelScanAnalysis: resolveCancelScanForDate(date, cancelScanAnalysis),
    }
  })
}

/** @deprecated 使用 captureEfficiencyAttendanceDayRecords */
export function buildDailyEfficiencyRecordSnapshots(
  input: EfficiencyAttendancePageCaptureInput,
): EfficiencyAttendanceDayRecord[] {
  return captureEfficiencyAttendanceDayRecords(input)
}

export function summarizeEfficiencyAttendanceDayRecord(
  record: EfficiencyAttendanceDayRecord,
): Omit<EfficiencyAttendanceDayRecordListItem, 'updatedAt'> {
  const daily = record.warehouse.daily
  const kind = resolveEfficiencyAttendanceDayKind(daily)
  // 仅考勤日（分子为 0）与无考勤日（分母为 0）都算不出当日效率，列表显示「—」而非 0
  const hasDayEfficiency = kind === 'full'
  const dayEfficiency = hasDayEfficiency ? daily.dayEfficiency : null
  const openEfficiency = hasDayEfficiency
    ? daily.isOpenDay && daily.totalHours > 0
      ? daily.volume / daily.totalHours
      : dayEfficiency
    : null
  const overallEfficiency = hasDayEfficiency
    ? daily.totalHours > 0
      ? daily.volume / daily.totalHours
      : dayEfficiency
    : null
  const totalLaborCost = record.payroll?.totalLaborCost ?? null

  return {
    date: record.date,
    kind,
    volume: daily.volume,
    dayEfficiency: dayEfficiency != null ? round2(dayEfficiency) : null,
    openEfficiency: openEfficiency != null ? round2(openEfficiency) : null,
    overallEfficiency: overallEfficiency != null ? round2(overallEfficiency) : null,
    sortingEfficiency: record.scanner?.summary.totalEfficiency ?? null,
    hasFrontDesk: Boolean(record.frontDesk?.densityRows.length || record.frontDesk?.clockOut),
    totalLaborCost,
    costPerTicket:
      totalLaborCost != null && daily.volume > 0 ? round2(totalLaborCost / daily.volume) : null,
  }
}

/** @deprecated 使用 summarizeEfficiencyAttendanceDayRecord */
export function summarizeDailyEfficiencyRecord(record: EfficiencyAttendanceDayRecord): DailyEfficiencyRecordListItem {
  return { ...summarizeEfficiencyAttendanceDayRecord(record), updatedAt: '' }
}

/** 将一条或多条按日存档还原为效率考勤页只读态（查看入口） */
export function restoreEfficiencyAttendancePage(
  records: EfficiencyAttendanceDayRecord[],
): EfficiencyAttendancePageRestore {
  if (!records.length) {
    throw new Error(String(i18n.t('snapshot.noRecords', { ns: 'scannerEfficiency' })))
  }

  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date))
  const dates = sorted.map((record) => record.date)
  const settings = sorted[0]!.computation
  const dailyRows = sorted.map((record) => record.warehouse.daily).sort((a, b) => a.date.localeCompare(b.date))

  const totalVolume = dailyRows.reduce((sum, row) => sum + row.volume, 0)
  const totalCainiaoVolume = dailyRows.reduce((sum, row) => sum + row.cainiaoVolume, 0)
  const totalSheinVolume = dailyRows.reduce((sum, row) => sum + (row.sheinVolume ?? 0), 0)
  const totalTemuVolume = dailyRows.reduce((sum, row) => sum + (row.temuVolume ?? 0), 0)
  const rangeStart = dates[0]!
  const rangeEnd = dates[dates.length - 1]!

  const scanAggregate: ScanAggregate = {
    dailyRows: dailyRows.map((row) => ({
      date: row.date,
      volume: row.volume,
      cainiaoVolume: row.cainiaoVolume,
      cainiaoShare: row.cainiaoShare,
      sheinVolume: row.sheinVolume ?? 0,
      sheinShare: row.sheinShare ?? 0,
      temuVolume: row.temuVolume ?? 0,
      temuShare: row.temuShare ?? 0,
      scannerCount: row.sorterCount,
    })),
    dailyMap: new Map(),
    summary: {
      totalVolume,
      totalCainiaoVolume,
      cainiaoShareWindow: totalVolume > 0 ? totalCainiaoVolume / totalVolume : 0,
      totalSheinVolume,
      sheinShareWindow: totalVolume > 0 ? totalSheinVolume / totalVolume : 0,
      totalTemuVolume,
      temuShareWindow: totalVolume > 0 ? totalTemuVolume / totalVolume : 0,
      totalDays: dailyRows.length,
      hasScanner: dailyRows.some((row) => row.sorterCount > 0),
    },
  }

  const matchedRows = dailyRows.filter((row) => row.hasAttendance)
  const allHours = matchedRows.reduce((sum, row) => sum + row.totalHours, 0)
  const openRows = matchedRows.filter((row) => row.isOpenDay)
  const openHours = openRows.reduce((sum, row) => sum + row.totalHours, 0)
  const openDayVolume = openRows.reduce((sum, row) => sum + row.volume, 0)
  const openDayCainiaoVolume = openRows.reduce((sum, row) => sum + row.cainiaoVolume, 0)
  const openDayVolumeForCainiao = openRows.reduce((sum, row) => sum + row.volume, 0)
  const openDaySheinVolume = openRows.reduce((sum, row) => sum + (row.sheinVolume ?? 0), 0)
  const openDayTemuVolume = openRows.reduce((sum, row) => sum + (row.temuVolume ?? 0), 0)

  const attendanceResult: AttendanceEfficiencyResult = {
    dailyRows,
    personRows: mergePersonRowsFromRecords(sorted),
    summary: {
      uploadedVolume: totalVolume,
      efficiencyRangeStart: rangeStart,
      efficiencyRangeEnd: rangeEnd,
      attendanceSheetRangeStart: rangeStart,
      attendanceSheetRangeEnd: rangeEnd,
      matchedVolume: matchedRows.reduce((sum, row) => sum + row.volume, 0),
      intersectionMatchHours: matchedRows
        .filter((row) => !row.isAttendanceOnly)
        .reduce((sum, row) => sum + row.totalHours, 0),
      allHours,
      openHours,
      openDayVolume,
      openDayCount: openRows.length,
      matchedDayCount: matchedRows.length,
      unmatchedDayCount: dailyRows.filter((row) => !row.hasAttendance).length,
      unmatchedDates: dailyRows.filter((row) => !row.hasAttendance).map((row) => row.date),
      attendanceOnlyDates: dailyRows.filter((row) => row.isAttendanceOnly).map((row) => row.date),
      attendanceOnlyDateCount: dailyRows.filter((row) => row.isAttendanceOnly).length,
      attendanceOnlyInWindowCount: dailyRows.filter((row) => row.isAttendanceOnly).length,
      openEfficiency: openHours > 0 ? totalVolume / openHours : 0,
      overallEfficiency: allHours > 0 ? totalVolume / allHours : 0,
      openDayVolumeEfficiency: openHours > 0 ? openDayVolume / openHours : 0,
      totalCainiaoVolume,
      cainiaoShareWindow: scanAggregate.summary.cainiaoShareWindow,
      cainiaoShareOpenDays:
        openDayVolumeForCainiao > 0 ? openDayCainiaoVolume / openDayVolumeForCainiao : 0,
      totalSheinVolume,
      sheinShareWindow: scanAggregate.summary.sheinShareWindow,
      sheinShareOpenDays: openDayVolumeForCainiao > 0 ? openDaySheinVolume / openDayVolumeForCainiao : 0,
      totalTemuVolume,
      temuShareWindow: scanAggregate.summary.temuShareWindow,
      temuShareOpenDays: openDayVolumeForCainiao > 0 ? openDayTemuVolume / openDayVolumeForCainiao : 0,
    },
  }

  const archiveLabel = String(i18n.t('snapshot.archiveLabel', { ns: 'scannerEfficiency', count: dates.length }))

  return {
    settings,
    scanAggregate,
    attendanceResult,
    attendanceRows: personDayRowsToAttendanceRows(
      sorted.flatMap((record) => record.warehouse.personDayRows),
    ),
    scannerResult: mergeScannerData(sorted),
    allocationDensityRows: sorted.flatMap((record) => record.frontDesk?.densityRows ?? []),
    frontDeskClockOutRows: sorted
      .map((record) => record.frontDesk?.clockOut ?? null)
      .filter((row): row is FrontDeskClockOutDayRow => row != null),
    scanSourceInfo: mergeSourceInfo(
      sorted.map((record) => record.provenance.scan),
      archiveLabel,
    ),
    attendanceSourceInfo: mergeSourceInfo(
      sorted.map((record) => record.provenance.attendance),
      archiveLabel,
    ),
    allocationSourceInfo: mergeSourceInfo(
      sorted.map((record) => record.provenance.allocation),
      archiveLabel,
    ),
    attendancePayroll: buildAttendancePayrollFromRecords(sorted),
    cancelScanAnalysis: mergeCancelScanAnalysis(sorted),
    restoredDate: formatRestoredDateLabel(dates),
    restoredDates: dates,
  }
}

/** @deprecated 使用 restoreEfficiencyAttendancePage */
export function buildRestoreStateFromDailyPayloads(
  records: EfficiencyAttendanceDayRecord[],
): EfficiencyAttendancePageRestore {
  return restoreEfficiencyAttendancePage(records)
}

/** @deprecated 使用 restoreEfficiencyAttendancePage([record]) */
export function buildRestoreStateFromDailyPayload(
  record: EfficiencyAttendanceDayRecord,
): EfficiencyAttendancePageRestore {
  return restoreEfficiencyAttendancePage([record])
}

export function toEfficiencyAttendanceDayRecordListItem(
  record: EfficiencyAttendanceDayRecord,
  updatedAt: string,
): EfficiencyAttendanceDayRecordListItem {
  return {
    ...summarizeEfficiencyAttendanceDayRecord(record),
    updatedAt,
  }
}

/** @deprecated 使用 toEfficiencyAttendanceDayRecordListItem */
export function toDailyEfficiencyRecordListItem(
  record: EfficiencyAttendanceDayRecord,
  updatedAt: string,
): EfficiencyAttendanceDayRecordListItem {
  return toEfficiencyAttendanceDayRecordListItem(record, updatedAt)
}
