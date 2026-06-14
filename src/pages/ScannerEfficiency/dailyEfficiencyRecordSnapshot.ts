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

export const DAILY_EFFICIENCY_RECORD_SCHEMA_VERSION = 1 as const

export type DailyEfficiencyRecordSettings = Pick<
  ScanSettings,
  | 'openDayThreshold'
  | 'breakCapMinutes'
  | 'splitThresholdMinutes'
  | 'minSingleScanSessionMinutes'
  | 'minDayScanCount'
>

export type DailyEfficiencyPersonDayRow = Pick<
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

export type DailyEfficiencyWarehouseSlice = {
  daily: AttendanceEfficiencyResult['dailyRows'][number]
  personRows: AttendanceEfficiencyResult['personRows']
  personDayRows: DailyEfficiencyPersonDayRow[]
}

export type DailyEfficiencyScannerSlice = {
  dailySummaryRow: ScannerEfficiencyResult['dailySummaryRows'][number] | null
  dailyScannerRows: ScannerEfficiencyResult['dailyScannerRows']
  scannerHourlyRows: ScannerEfficiencyResult['scannerHourlyRows']
  scannerTotalRows: ScannerEfficiencyResult['scannerTotalRows']
  summary: ScannerEfficiencyResult['summary']
}

export type DailyEfficiencyFrontDeskSlice = {
  densityRows: FrontDeskDensityRow[]
  clockOut: FrontDeskClockOutDayRow | null
}

export type DailyEfficiencyCancelScanSlice = CancelScanAnalysisState

export type DailyEfficiencyRecordPayload = {
  schemaVersion: typeof DAILY_EFFICIENCY_RECORD_SCHEMA_VERSION
  date: string
  settings: DailyEfficiencyRecordSettings
  warehouse: DailyEfficiencyWarehouseSlice
  scanner: DailyEfficiencyScannerSlice | null
  frontDesk: DailyEfficiencyFrontDeskSlice | null
  /** 所选日期区间覆盖该日时的取消扫描分析快照 */
  cancelScanAnalysis?: DailyEfficiencyCancelScanSlice | null
  source: {
    scanSourceInfo: SourceInfo
    attendanceSourceInfo: SourceInfo
    allocationSourceInfo: SourceInfo
  }
}

export type DailyEfficiencyRecordListItem = {
  date: string
  updatedAt: string
  volume: number | null
  dayEfficiency: number | null
  openEfficiency: number | null
  overallEfficiency: number | null
  sortingEfficiency: number | null
  hasFrontDesk: boolean
}

const SCANNER_RELIABILITY_BASE_SCAN_COUNT = 1100
const SCANNER_RELIABILITY_BASE_EFFECTIVE_HOURS = 2.35

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function isDateInInclusiveRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

function resolveCancelScanSliceForDate(
  date: string,
  cancelScanAnalysis: CancelScanAnalysisState | null | undefined,
): DailyEfficiencyCancelScanSlice | null {
  if (!cancelScanAnalysis) return null
  const { startDate, endDate } = cancelScanAnalysis.meta
  if (!isDateInInclusiveRange(date, startDate, endDate)) return null
  return cancelScanAnalysis
}

function mergeCancelScanAnalysis(
  payloads: DailyEfficiencyRecordPayload[],
): CancelScanAnalysisState | null {
  const slices = payloads
    .map((payload) => payload.cancelScanAnalysis)
    .filter((item): item is DailyEfficiencyCancelScanSlice => item != null)
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

function buildScannerTotalRowsForDay(
  dailyScannerRows: ScannerEfficiencyResult['dailyScannerRows'],
  windowTotalEfficiency: number,
): ScannerEfficiencyResult['scannerTotalRows'] {
  const byScanner = new Map<
    string,
    { scanner: string; scanCount: number; effectiveMinutes: number; activeDateSet: Set<string> }
  >()

  for (const row of dailyScannerRows) {
    if (!byScanner.has(row.scanner)) {
      byScanner.set(row.scanner, {
        scanner: row.scanner,
        scanCount: 0,
        effectiveMinutes: 0,
        activeDateSet: new Set(),
      })
    }
    const item = byScanner.get(row.scanner)!
    item.scanCount += row.scanCount
    item.effectiveMinutes += row.effectiveMinutes
    item.activeDateSet.add(row.date)
  }

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
      return {
        scanner: item.scanner,
        scanCount: item.scanCount,
        activeDays,
        effectiveHours: round4(effectiveHours),
        efficiency: round2(efficiency),
        reliabilityWeight: round4(reliabilityWeight),
        adjustedEfficiency: round2(adjustedEfficiency),
      }
    })
    .sort((a, b) => b.adjustedEfficiency - a.adjustedEfficiency)
}

function buildPersonRowsFromPersonDayRows(
  personDayRows: DailyEfficiencyPersonDayRow[],
  isOpenDay: boolean,
): AttendanceEfficiencyResult['personRows'] {
  const map = new Map<
    string,
    {
      sorterKey: string
      sorterName: string
      totalHours: number
      matchNames: Set<string>
    }
  >()

  for (const row of personDayRows) {
    if (!map.has(row.sorterKey)) {
      map.set(row.sorterKey, {
        sorterKey: row.sorterKey,
        sorterName: row.sorterName || row.sorterKey,
        totalHours: 0,
        matchNames: new Set(),
      })
    }
    const person = map.get(row.sorterKey)!
    person.totalHours += row.hours
    ;[row.sorterName, row.sorterKey, row.nameNick, row.nameFull].forEach((label) => {
      const text = String(label ?? '').trim()
      if (text) person.matchNames.add(text)
    })
  }

  return Array.from(map.values())
    .map((person) => ({
      sorterKey: person.sorterKey,
      sorterName: person.sorterName,
      totalHours: person.totalHours,
      activeDays: 1,
      openDays: isOpenDay ? 1 : 0,
      efficiencyMatchNames: Array.from(person.matchNames),
    }))
    .sort((a, b) => b.totalHours - a.totalHours)
}

function buildScannerSliceForDate(
  scannerResult: ScannerEfficiencyResult | null,
  date: string,
): DailyEfficiencyScannerSlice | null {
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
    dailySummaryRow: dailySummaryRow
      ? {
          ...dailySummaryRow,
          scanCount: dailySummaryRow.scanCount,
          effectiveHours: round4(dailySummaryRow.effectiveHours),
          efficiency: round2(dailySummaryRow.efficiency),
        }
      : totalScanCount > 0
        ? {
            date,
            scanCount: totalScanCount,
            scannerCount: new Set(dailyScannerRows.map((row) => row.scanner)).size,
            effectiveHours: round4(totalEffectiveHours),
            efficiency: round2(totalEfficiency),
          }
        : null,
    dailyScannerRows: dailyScannerRows.map((row) => ({
      ...row,
      effectiveHours: round4(row.effectiveHours),
      efficiency: round2(row.efficiency),
    })),
    scannerHourlyRows,
    scannerTotalRows,
    summary: {
      totalScanCount,
      totalEffectiveHours: round4(totalEffectiveHours),
      totalEfficiency: round2(totalEfficiency),
      totalDays: dailySummaryRow || dailyScannerRows.length ? 1 : 0,
      totalScanners: scannerTotalRows.length,
    },
  }
}

export function buildDailyEfficiencyRecordSnapshots(input: {
  attendanceResult: AttendanceEfficiencyResult
  attendanceRows: ParsedAttendanceRow[]
  scannerResult: ScannerEfficiencyResult | null
  allocationDensityRows: FrontDeskDensityRow[]
  frontDeskClockOutRows: FrontDeskClockOutDayRow[]
  cancelScanAnalysis?: CancelScanAnalysisState | null
  settings: ScanSettings
  scanSourceInfo: SourceInfo
  attendanceSourceInfo: SourceInfo
  allocationSourceInfo: SourceInfo
}): DailyEfficiencyRecordPayload[] {
  const {
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
  } = input

  const dates = attendanceResult.dailyRows
    .filter((row) => row.hasAttendance && !row.isAttendanceOnly)
    .map((row) => row.date)
    .sort((a, b) => a.localeCompare(b))

  const settingsSlice: DailyEfficiencyRecordSettings = {
    openDayThreshold: settings.openDayThreshold,
    breakCapMinutes: settings.breakCapMinutes,
    splitThresholdMinutes: settings.splitThresholdMinutes,
    minSingleScanSessionMinutes: settings.minSingleScanSessionMinutes,
    minDayScanCount: settings.minDayScanCount,
  }

  return dates.map((date) => {
    const daily = attendanceResult.dailyRows.find((row) => row.date === date)!
    const personDayRows = attendanceRows
      .filter((row) => row.date === date)
      .map(
        (row): DailyEfficiencyPersonDayRow => ({
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
      schemaVersion: DAILY_EFFICIENCY_RECORD_SCHEMA_VERSION,
      date,
      settings: settingsSlice,
      warehouse: {
        daily,
        personRows: buildPersonRowsFromPersonDayRows(personDayRows, daily.isOpenDay),
        personDayRows,
      },
      scanner: buildScannerSliceForDate(scannerResult, date),
      frontDesk: {
        densityRows: allocationDensityRows.filter((row) => row.date === date),
        clockOut: frontDeskClockOutRows.find((row) => row.date === date) ?? null,
      },
      cancelScanAnalysis: resolveCancelScanSliceForDate(date, cancelScanAnalysis),
      source: {
        scanSourceInfo,
        attendanceSourceInfo,
        allocationSourceInfo,
      },
    }
  })
}

export function summarizeDailyEfficiencyRecord(payload: DailyEfficiencyRecordPayload): DailyEfficiencyRecordListItem {
  const daily = payload.warehouse.daily
  const dayEfficiency = daily.dayEfficiency
  const openEfficiency =
    daily.isOpenDay && daily.totalHours > 0 ? daily.volume / daily.totalHours : dayEfficiency
  const overallEfficiency = daily.totalHours > 0 ? daily.volume / daily.totalHours : dayEfficiency

  return {
    date: payload.date,
    updatedAt: '',
    volume: daily.volume,
    dayEfficiency: dayEfficiency != null ? round2(dayEfficiency) : null,
    openEfficiency: openEfficiency != null ? round2(openEfficiency) : null,
    overallEfficiency: overallEfficiency != null ? round2(overallEfficiency) : null,
    sortingEfficiency: payload.scanner?.summary.totalEfficiency ?? null,
    hasFrontDesk: Boolean(payload.frontDesk?.densityRows.length || payload.frontDesk?.clockOut),
  }
}

export type DailyEfficiencyRestoreState = {
  settings: DailyEfficiencyRecordSettings
  scanAggregate: ScanAggregate
  attendanceResult: AttendanceEfficiencyResult
  attendanceRows: ParsedAttendanceRow[]
  scannerResult: ScannerEfficiencyResult | null
  allocationDensityRows: FrontDeskDensityRow[]
  frontDeskClockOutRows: FrontDeskClockOutDayRow[]
  scanSourceInfo: SourceInfo
  attendanceSourceInfo: SourceInfo
  allocationSourceInfo: SourceInfo
  cancelScanAnalysis: CancelScanAnalysisState | null
  /** 展示用：单日为 YYYY-MM-DD，多日为 YYYY-MM-DD ~ YYYY-MM-DD */
  restoredDate: string
  restoredDates: string[]
}

function personDayRowsToAttendanceRows(personDayRows: DailyEfficiencyPersonDayRow[]): ParsedAttendanceRow[] {
  return personDayRows.map((row) => ({
    ...row,
    positionCode: undefined,
    clockInTime: null,
    clockOutTime: null,
    workday: undefined,
    surname: undefined,
    sourceFileName: '效率考勤记录',
    sourceSheetName: '',
    sourceRowNumber: 0,
  }))
}

function mergePersonRowsFromPayloads(
  payloads: DailyEfficiencyRecordPayload[],
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

  for (const payload of payloads) {
    const isOpenDay = payload.warehouse.daily.isOpenDay
    for (const row of payload.warehouse.personDayRows) {
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

function mergeScannerSlice(payloads: DailyEfficiencyRecordPayload[]): ScannerEfficiencyResult | null {
  const slices = payloads.map((payload) => payload.scanner).filter(Boolean) as DailyEfficiencyScannerSlice[]
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
      totalEffectiveHours: round4(totalEffectiveHours),
      totalEfficiency: round2(totalEfficiency),
      totalDays: dailySummaryRows.length,
      totalScanners: scannerTotalRows.length,
    },
  }
}

function mergeSourceInfo(items: SourceInfo[], label: string): SourceInfo {
  const fileNames = Array.from(new Set(items.flatMap((item) => item.fileNames)))
  return {
    fileCount: fileNames.length,
    rowCount: items.reduce((sum, item) => sum + item.rowCount, 0),
    droppedRows: items.reduce((sum, item) => sum + item.droppedRows, 0),
    duplicateWaybillRows: items.reduce((sum, item) => sum + (item.duplicateWaybillRows ?? 0), 0),
    fileNames: fileNames.length ? fileNames : [label],
  }
}

function buildScannerResultFromSlice(scanner: DailyEfficiencyScannerSlice): ScannerEfficiencyResult {
  const totalEfficiency = scanner.summary.totalEfficiency
  const scannerTotalRows = buildScannerTotalRowsForDay(scanner.dailyScannerRows, totalEfficiency)
  return {
    dailyScannerRows: scanner.dailyScannerRows,
    scannerHourlyRows: scanner.scannerHourlyRows,
    dailySummaryRows: scanner.dailySummaryRow ? [scanner.dailySummaryRow] : [],
    scannerTotalRows,
    summary: {
      ...scanner.summary,
      totalScanners: scannerTotalRows.length,
    },
  }
}

function resolvePersonRowsForRestore(
  warehouse: DailyEfficiencyWarehouseSlice,
  daily: AttendanceEfficiencyResult['dailyRows'][number],
): AttendanceEfficiencyResult['personRows'] {
  if (warehouse.personDayRows.length) {
    return buildPersonRowsFromPersonDayRows(warehouse.personDayRows, daily.isOpenDay)
  }
  if (!warehouse.personRows.length) return []
  // 旧快照缺少 personDayRows 时：按 activeDays 均分工时，避免单日查看仍用整窗工时作分母
  return warehouse.personRows.map((row) => ({
    ...row,
    totalHours: row.activeDays > 1 ? round4(row.totalHours / row.activeDays) : row.totalHours,
    activeDays: 1,
    openDays: daily.isOpenDay ? 1 : 0,
  }))
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
  if (sorted.length <= 4) return `${sorted.length} 天（${sorted.join('、')}）`
  return `${sorted.length} 天（${sorted[0]}、…、${sorted[sorted.length - 1]}）`
}

export function buildRestoreStateFromDailyPayloads(
  payloads: DailyEfficiencyRecordPayload[],
): DailyEfficiencyRestoreState {
  if (!payloads.length) {
    throw new Error('没有可还原的效率考勤记录')
  }

  const sorted = [...payloads].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 1) {
    const single = buildRestoreStateFromDailyPayload(sorted[0]!)
    return {
      ...single,
      restoredDates: [sorted[0]!.date],
    }
  }

  const dates = sorted.map((payload) => payload.date)
  const settings = sorted[0]!.settings
  const dailyRows = sorted.map((payload) => payload.warehouse.daily).sort((a, b) => a.date.localeCompare(b.date))

  const totalVolume = dailyRows.reduce((sum, row) => sum + row.volume, 0)
  const totalCainiaoVolume = dailyRows.reduce((sum, row) => sum + row.cainiaoVolume, 0)
  const rangeStart = dates[0]!
  const rangeEnd = dates[dates.length - 1]!

  const scanAggregate: ScanAggregate = {
    dailyRows: dailyRows.map((row) => ({
      date: row.date,
      volume: row.volume,
      cainiaoVolume: row.cainiaoVolume,
      cainiaoShare: row.cainiaoShare,
      scannerCount: row.sorterCount,
    })),
    dailyMap: new Map(),
    summary: {
      totalVolume,
      totalCainiaoVolume,
      cainiaoShareWindow: totalVolume > 0 ? totalCainiaoVolume / totalVolume : 0,
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

  const attendanceResult: AttendanceEfficiencyResult = {
    dailyRows,
    personRows: mergePersonRowsFromPayloads(sorted),
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
    },
  }

  const attendanceRows = personDayRowsToAttendanceRows(
    sorted.flatMap((payload) => payload.warehouse.personDayRows),
  )

  const allocationDensityRows = sorted.flatMap((payload) => payload.frontDesk?.densityRows ?? [])
  const frontDeskClockOutRows = sorted
    .map((payload) => payload.frontDesk?.clockOut ?? null)
    .filter((row): row is FrontDeskClockOutDayRow => row != null)

  const archiveLabel = `效率考勤记录（${dates.length} 天）`

  return {
    settings,
    scanAggregate,
    attendanceResult,
    attendanceRows,
    scannerResult: mergeScannerSlice(sorted),
    allocationDensityRows,
    frontDeskClockOutRows,
    scanSourceInfo: mergeSourceInfo(
      sorted.map((payload) => payload.source.scanSourceInfo),
      archiveLabel,
    ),
    attendanceSourceInfo: mergeSourceInfo(
      sorted.map((payload) => payload.source.attendanceSourceInfo),
      archiveLabel,
    ),
    allocationSourceInfo: mergeSourceInfo(
      sorted.map((payload) => payload.source.allocationSourceInfo),
      archiveLabel,
    ),
    cancelScanAnalysis: mergeCancelScanAnalysis(sorted),
    restoredDate: formatRestoredDateLabel(dates),
    restoredDates: dates,
  }
}

export function buildRestoreStateFromDailyPayload(
  payload: DailyEfficiencyRecordPayload,
): DailyEfficiencyRestoreState {
  const { date, warehouse, scanner, frontDesk, settings, source } = payload
  const daily = warehouse.daily

  const scanAggregate: ScanAggregate = {
    dailyRows: [
      {
        date,
        volume: daily.volume,
        cainiaoVolume: daily.cainiaoVolume,
        cainiaoShare: daily.cainiaoShare,
        scannerCount: daily.sorterCount,
      },
    ],
    dailyMap: new Map(),
    summary: {
      totalVolume: daily.volume,
      totalCainiaoVolume: daily.cainiaoVolume,
      cainiaoShareWindow: daily.cainiaoShare,
      totalDays: 1,
      hasScanner: daily.sorterCount > 0,
    },
  }

  const openHours = daily.isOpenDay ? daily.totalHours : 0
  const openDayVolume = daily.isOpenDay ? daily.volume : 0

  const attendanceResult: AttendanceEfficiencyResult = {
    dailyRows: [daily],
    personRows: resolvePersonRowsForRestore(warehouse, daily),
    summary: {
      uploadedVolume: daily.volume,
      efficiencyRangeStart: date,
      efficiencyRangeEnd: date,
      attendanceSheetRangeStart: date,
      attendanceSheetRangeEnd: date,
      matchedVolume: daily.volume,
      intersectionMatchHours: daily.totalHours,
      allHours: daily.totalHours,
      openHours,
      openDayVolume,
      openDayCount: daily.isOpenDay ? 1 : 0,
      matchedDayCount: 1,
      unmatchedDayCount: 0,
      unmatchedDates: [],
      attendanceOnlyDates: [],
      attendanceOnlyDateCount: 0,
      attendanceOnlyInWindowCount: 0,
      openEfficiency: openHours > 0 ? daily.volume / openHours : 0,
      overallEfficiency: daily.totalHours > 0 ? daily.volume / daily.totalHours : 0,
      openDayVolumeEfficiency: openHours > 0 ? openDayVolume / openHours : 0,
      totalCainiaoVolume: daily.cainiaoVolume,
      cainiaoShareWindow: daily.cainiaoShare,
      cainiaoShareOpenDays: daily.isOpenDay ? daily.cainiaoShare : 0,
    },
  }

  const attendanceRows: ParsedAttendanceRow[] = personDayRowsToAttendanceRows(warehouse.personDayRows)

  const scannerResult: ScannerEfficiencyResult | null = scanner ? buildScannerResultFromSlice(scanner) : null

  return {
    settings,
    scanAggregate,
    attendanceResult,
    attendanceRows,
    scannerResult,
    allocationDensityRows: frontDesk?.densityRows ?? [],
    frontDeskClockOutRows: frontDesk?.clockOut ? [frontDesk.clockOut] : [],
    scanSourceInfo: source.scanSourceInfo,
    attendanceSourceInfo: source.attendanceSourceInfo,
    allocationSourceInfo: source.allocationSourceInfo,
    cancelScanAnalysis: payload.cancelScanAnalysis ?? null,
    restoredDate: date,
    restoredDates: [date],
  }
}

export function toDailyEfficiencyRecordListItem(
  payload: DailyEfficiencyRecordPayload,
  updatedAt: string,
): DailyEfficiencyRecordListItem {
  return {
    ...summarizeDailyEfficiencyRecord(payload),
    updatedAt,
  }
}
