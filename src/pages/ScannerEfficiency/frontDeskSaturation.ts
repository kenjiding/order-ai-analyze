import type {
  AttendanceEfficiencyResult,
  ParsedAllocationRow,
  ParsedAttendanceRow,
  ScannerEfficiencyResult,
} from './aggregates'
import { dayjs } from './dayjsSetup'
import { formatDateTime } from './formatAndParse'
import { normalizeScannerKey } from './sortingLookup'

const DENSITY_SLOT_MINUTES = 30
const CLOCK_OUT_OUTLIER_MINUTES_FLOOR = 90
/** 同半小时段内分配笔数须大于该值，才视为下午集中分配起始（排除派送员零星早到）。 */
const ALLOCATION_START_SLOT_MIN_COUNT = 2
const BOX_CUTTING_BUFFER_MINUTES = 50

export type FrontDeskSaturationStatus = 'missing' | 'idle' | 'loose' | 'reasonable' | 'tight' | 'delayed'

export type FrontDeskDailySaturationRow = {
  date: string
  volume: number
  totalHours: number
  frontDeskCount: number
  frontDeskHours: number
  frontDeskClockInTime: Date | null
  frontDeskClockInLabel: string
  frontDeskLastClockOutTime: Date | null
  frontDeskLastClockOutLabel: string
  frontDeskLastClockOutPerson: string
  frontDeskLastClockOutSlot: string
  lastAllocationTime: Date | null
  lastAllocationLabel: string
  offDutyIdleMinutes: number | null
  allocationCount: number
  morningAllocationCount: number
  afternoonAllocationCount: number
  peakSlot: string
  peakSlotCount: number
  sorterClockOutTime: Date | null
  sorterClockOutLabel: string
  sortingReadyTime: Date | null
  sortingReadyLabel: string
  firstAfternoonAllocationTime: Date | null
  firstAfternoonAllocationLabel: string
  firstAfternoonGapMinutes: number | null
  boxesPerFrontDeskHour: number | null
  expectedFrontDeskHours: number | null
  surplusFrontDeskHours: number | null
  frontDeskSortingEffectiveHours: number
  frontDeskSortingParticipationRate: number | null
  saturationIndex: number | null
  status: FrontDeskSaturationStatus
  statusLabel: string
}

export type FrontDeskDensityRow = {
  date: string
  timeSlot: string
  allocationCount: number
  window: 'morning' | 'afternoon'
}

export type FrontDeskSaturationResult = {
  dailyRows: FrontDeskDailySaturationRow[]
  densityRows: FrontDeskDensityRow[]
  summary: {
    totalFrontDeskHours: number
    totalAllocationCount: number
    totalSurplusFrontDeskHours: number
    avgSaturationIndex: number | null
    avgBoxesPerFrontDeskHour: number | null
    avgFirstAfternoonGapMinutes: number | null
    frontDeskSortingParticipationRate: number | null
    benchmarkBoxesPerFrontDeskHour: number | null
    riskDayCount: number
    missingFrontDeskDayCount: number
  }
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (!sorted.length) return null
  if (sorted.length === 1) return sorted[0]!
  const pos = (sorted.length - 1) * p
  const low = Math.floor(pos)
  const high = Math.ceil(pos)
  if (low === high) return sorted[low]!
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (pos - low)
}

function minutesSinceDayStart(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
}

function dateWithMinutes(dateKey: string, minutes: number): Date {
  return dayjs(dateKey).startOf('day').add(minutes, 'minute').toDate()
}

function robustMedianClockOut(dateKey: string, clockOutTimes: Date[]): Date | null {
  const minutes = clockOutTimes.map(minutesSinceDayStart).filter(Number.isFinite)
  if (!minutes.length) return null
  if (minutes.length < 4) {
    const value = median(minutes)
    return value == null ? null : dateWithMinutes(dateKey, value)
  }

  const firstMedian = median(minutes)
  if (firstMedian == null) return null
  const deviations = minutes.map((value) => Math.abs(value - firstMedian))
  const mad = median(deviations) ?? 0
  const limit = Math.max(CLOCK_OUT_OUTLIER_MINUTES_FLOOR, mad * 3)
  const filtered = minutes.filter((value) => Math.abs(value - firstMedian) <= limit)
  const stable = filtered.length >= Math.ceil(minutes.length * 0.6) ? filtered : minutes
  const value = median(stable)
  return value == null ? null : dateWithMinutes(dateKey, value)
}

function slotIndex(date: Date): number {
  return date.getHours() * (60 / DENSITY_SLOT_MINUTES) + Math.floor(date.getMinutes() / DENSITY_SLOT_MINUTES)
}

function slotLabel(index: number): string {
  const startMinutes = index * DENSITY_SLOT_MINUTES
  const endMinutes = startMinutes + DENSITY_SLOT_MINUTES
  const startHour = Math.floor(startMinutes / 60)
  const startMinute = startMinutes % 60
  const endHour = Math.floor(endMinutes / 60) % 24
  const endMinute = endMinutes % 60
  return `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}–${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`
}

/** 取下午窗口内首个「半小时段分配数 > ALLOCATION_START_SLOT_MIN_COUNT」的时段，以该段内第 3 笔分配时间作为集中起始。 */
function concentratedStartTime(rows: ParsedAllocationRow[]): Date | null {
  if (!rows.length) return null

  const bySlot = new Map<number, ParsedAllocationRow[]>()
  for (const row of rows) {
    const key = slotIndex(row.allocationTime)
    if (!bySlot.has(key)) bySlot.set(key, [])
    bySlot.get(key)!.push(row)
  }

  const concentratedSlot = Array.from(bySlot.entries())
    .filter(([, slotRows]) => slotRows.length > ALLOCATION_START_SLOT_MIN_COUNT)
    .sort((a, b) => a[0] - b[0])[0]

  if (!concentratedSlot) return null

  const sortedTimes = concentratedSlot[1]
    .map((row) => row.allocationTime)
    .sort((a, b) => a.getTime() - b.getTime())
  const startIndex = ALLOCATION_START_SLOT_MIN_COUNT
  return sortedTimes[startIndex] ?? sortedTimes[sortedTimes.length - 1] ?? null
}

function addScannerAliases(raw: unknown, out: Set<string>) {
  const text = String(raw ?? '').trim()
  if (!text) return

  const addOne = (value: string) => {
    const normalized = normalizeScannerKey(value)
    if (normalized) out.add(normalized)
    const parts = value.split('-').map((part) => part.trim()).filter(Boolean)
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]!
      if (last.length >= 2) out.add(normalizeScannerKey(last))
    }
  }

  addOne(text)
  text.split(/[\s,，/\\|、]+/).forEach(addOne)
}

function statusForRow(row: {
  frontDeskHours: number
  allocationCount: number
  saturationIndex: number | null
  firstAfternoonGapMinutes: number | null
}): { status: FrontDeskSaturationStatus; label: string } {
  if (!(row.frontDeskHours > 0)) return { status: 'missing', label: '缺少前台' }
  if (!(row.allocationCount > 0)) return { status: 'idle', label: '无分配' }
  if (row.firstAfternoonGapMinutes != null && row.firstAfternoonGapMinutes > 30) {
    return { status: 'delayed', label: '延迟风险' }
  }
  if (row.saturationIndex == null) return { status: 'reasonable', label: '待观察' }
  if (row.saturationIndex < 60) return { status: 'idle', label: '偏空' }
  if (row.saturationIndex < 85) return { status: 'loose', label: '偏松' }
  if (row.saturationIndex <= 115) return { status: 'reasonable', label: '合理' }
  return { status: 'tight', label: '偏紧' }
}

export function buildFrontDeskSaturation({
  attendanceResult,
  attendanceRows,
  allocationRows,
  scannerResult,
  afternoonStartHour,
}: {
  attendanceResult: AttendanceEfficiencyResult | null
  attendanceRows: ParsedAttendanceRow[]
  allocationRows: ParsedAllocationRow[]
  scannerResult: ScannerEfficiencyResult | null
  afternoonStartHour: number
}): FrontDeskSaturationResult | null {
  if (!attendanceResult) return null

  const rangeStart = attendanceResult.summary.efficiencyRangeStart
  const rangeEnd = attendanceResult.summary.efficiencyRangeEnd
  const inWindow = (date: string) => date >= rangeStart && date <= rangeEnd
  const afternoonStartMinutes = afternoonStartHour * 60

  const frontDeskByDate = new Map<
    string,
    {
      hours: number
      keys: Set<string>
      aliases: Set<string>
      clockOutRows: Array<{ inTime: Date | null; outTime: Date; person: string }>
    }
  >()
  const sorterClockOutByDate = new Map<string, Date[]>()

  for (const row of attendanceRows) {
    if (!inWindow(row.date)) continue
    if (row.isFrontDesk) {
      if (!frontDeskByDate.has(row.date)) {
        frontDeskByDate.set(row.date, { hours: 0, keys: new Set(), aliases: new Set(), clockOutRows: [] })
      }
      const bucket = frontDeskByDate.get(row.date)!
      bucket.hours += row.hours
      bucket.keys.add(row.sorterKey)
      if (row.clockOutTime) {
        bucket.clockOutRows.push({
          inTime: row.clockInTime ?? null,
          outTime: row.clockOutTime,
          person: row.sorterName || row.nameNick || row.nameFull || row.sorterKey,
        })
      }
      ;[row.sorterKey, row.sorterName, row.nameNick, row.nameFull].forEach((value) => addScannerAliases(value, bucket.aliases))
    } else if (row.isSorterWorker && row.clockOutTime) {
      if (!sorterClockOutByDate.has(row.date)) sorterClockOutByDate.set(row.date, [])
      sorterClockOutByDate.get(row.date)!.push(row.clockOutTime)
    }
  }

  const allocationByDate = new Map<string, ParsedAllocationRow[]>()
  for (const row of allocationRows) {
    if (!inWindow(row.date)) continue
    if (!allocationByDate.has(row.date)) allocationByDate.set(row.date, [])
    allocationByDate.get(row.date)!.push(row)
  }
  allocationByDate.forEach((rows) => rows.sort((a, b) => a.allocationTime.getTime() - b.allocationTime.getTime()))

  const frontDeskSortingHoursByDate = new Map<string, number>()
  for (const row of scannerResult?.dailyScannerRows ?? []) {
    const aliases = frontDeskByDate.get(row.date)?.aliases
    if (!aliases?.size) continue
    const scannerAliases = new Set<string>()
    addScannerAliases(row.scanner, scannerAliases)
    const matched = Array.from(scannerAliases).some((alias) => aliases.has(alias))
    if (!matched) continue
    frontDeskSortingHoursByDate.set(row.date, (frontDeskSortingHoursByDate.get(row.date) ?? 0) + row.effectiveHours)
  }

  const baseDailyRows = attendanceResult.dailyRows.map((day) => {
    const frontDesk = frontDeskByDate.get(day.date)
    const allocations = allocationByDate.get(day.date) ?? []
    const afternoonRows = allocations.filter((row) => minutesSinceDayStart(row.allocationTime) >= afternoonStartMinutes)
    const morningAllocationCount = allocations.length - afternoonRows.length
    const firstAfternoonAllocationTime = concentratedStartTime(afternoonRows)
    const sorterClockOutTime = robustMedianClockOut(day.date, sorterClockOutByDate.get(day.date) ?? [])
    const sortingReadyTime = sorterClockOutTime
      ? dayjs(sorterClockOutTime).subtract(BOX_CUTTING_BUFFER_MINUTES, 'minute').toDate()
      : null
    const firstAfternoonGapMinutes =
      firstAfternoonAllocationTime && sortingReadyTime
        ? (firstAfternoonAllocationTime.getTime() - sortingReadyTime.getTime()) / 60000
        : null
    const slotCounts = new Map<number, number>()
    for (const row of allocations) {
      const key = slotIndex(row.allocationTime)
      slotCounts.set(key, (slotCounts.get(key) ?? 0) + 1)
    }
    const peak = Array.from(slotCounts.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
    const frontDeskHours = frontDesk?.hours ?? 0
    const frontDeskLastClockOut = frontDesk?.clockOutRows.length
      ? frontDesk.clockOutRows.reduce((latest, current) => (current.outTime > latest.outTime ? current : latest), frontDesk.clockOutRows[0]!)
      : null
    const frontDeskClockInTime = frontDeskLastClockOut?.inTime ?? null
    const frontDeskLastClockOutTime = frontDeskLastClockOut?.outTime ?? null
    const lastAllocationTime = allocations.length ? allocations[allocations.length - 1]!.allocationTime : null
    const offDutyIdleMinutes =
      frontDeskLastClockOutTime && lastAllocationTime
        ? Math.max(0, (frontDeskLastClockOutTime.getTime() - lastAllocationTime.getTime()) / 60000)
        : null
    const allocationCount = allocations.length
    const boxesPerFrontDeskHour = frontDeskHours > 0 ? allocationCount / frontDeskHours : null
    const frontDeskSortingEffectiveHours = frontDeskSortingHoursByDate.get(day.date) ?? 0
    const frontDeskSortingParticipationRate =
      frontDeskHours > 0 ? frontDeskSortingEffectiveHours / frontDeskHours : null

    return {
      date: day.date,
      volume: day.volume,
      totalHours: day.totalHours,
      frontDeskCount: frontDesk?.keys.size ?? 0,
      frontDeskHours,
      frontDeskClockInTime,
      frontDeskClockInLabel: frontDeskClockInTime ? formatDateTime(frontDeskClockInTime) : '—',
      frontDeskLastClockOutTime,
      frontDeskLastClockOutLabel: frontDeskLastClockOutTime ? formatDateTime(frontDeskLastClockOutTime) : '—',
      frontDeskLastClockOutPerson: frontDeskLastClockOut?.person ?? '',
      frontDeskLastClockOutSlot: frontDeskLastClockOutTime ? slotLabel(slotIndex(frontDeskLastClockOutTime)) : '',
      lastAllocationTime,
      lastAllocationLabel: lastAllocationTime ? formatDateTime(lastAllocationTime) : '—',
      offDutyIdleMinutes,
      allocationCount,
      morningAllocationCount,
      afternoonAllocationCount: afternoonRows.length,
      peakSlot: peak ? slotLabel(peak[0]) : '—',
      peakSlotCount: peak?.[1] ?? 0,
      sorterClockOutTime,
      sorterClockOutLabel: sorterClockOutTime ? formatDateTime(sorterClockOutTime) : '—',
      sortingReadyTime,
      sortingReadyLabel: sortingReadyTime ? formatDateTime(sortingReadyTime) : '—',
      firstAfternoonAllocationTime,
      firstAfternoonAllocationLabel: firstAfternoonAllocationTime ? formatDateTime(firstAfternoonAllocationTime) : '—',
      firstAfternoonGapMinutes,
      boxesPerFrontDeskHour,
      expectedFrontDeskHours: null,
      surplusFrontDeskHours: null,
      frontDeskSortingEffectiveHours,
      frontDeskSortingParticipationRate,
      saturationIndex: null,
      status: 'reasonable' as FrontDeskSaturationStatus,
      statusLabel: '待观察',
    }
  })

  const benchmarkBoxesPerFrontDeskHour = percentile(
    baseDailyRows.map((row) => row.boxesPerFrontDeskHour ?? 0),
    0.75,
  )

  const dailyRows: FrontDeskDailySaturationRow[] = baseDailyRows.map((row) => {
    const expectedFrontDeskHours =
      benchmarkBoxesPerFrontDeskHour && row.allocationCount > 0
        ? row.allocationCount / benchmarkBoxesPerFrontDeskHour
        : null
    const surplusFrontDeskHours =
      expectedFrontDeskHours != null && row.frontDeskHours > 0
        ? Math.max(0, row.frontDeskHours - expectedFrontDeskHours)
        : null
    const saturationIndex =
      expectedFrontDeskHours != null && row.frontDeskHours > 0
        ? (expectedFrontDeskHours / row.frontDeskHours) * 100
        : null
    const status = statusForRow({
      frontDeskHours: row.frontDeskHours,
      allocationCount: row.allocationCount,
      saturationIndex,
      firstAfternoonGapMinutes: row.firstAfternoonGapMinutes,
    })
    return {
      ...row,
      expectedFrontDeskHours,
      surplusFrontDeskHours,
      saturationIndex,
      status: status.status,
      statusLabel: status.label,
    }
  })

  const densityRows: FrontDeskDensityRow[] = []
  const densityMap = new Map<string, { date: string; slot: number; count: number }>()
  for (const row of allocationRows) {
    if (!inWindow(row.date)) continue
    const slot = slotIndex(row.allocationTime)
    const key = `${row.date}\0${slot}`
    const existed = densityMap.get(key)
    if (existed) {
      existed.count += 1
    } else {
      densityMap.set(key, { date: row.date, slot, count: 1 })
    }
  }
  Array.from(densityMap.values())
    .sort((a, b) => (a.date === b.date ? a.slot - b.slot : a.date.localeCompare(b.date)))
    .forEach((row) => {
      densityRows.push({
        date: row.date,
        timeSlot: slotLabel(row.slot),
        allocationCount: row.count,
        window: row.slot * DENSITY_SLOT_MINUTES < afternoonStartMinutes ? 'morning' : 'afternoon',
      })
    })

  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
  const avgOf = (values: Array<number | null>) => {
    const valid = values.filter((value): value is number => value != null && Number.isFinite(value))
    return valid.length ? sum(valid) / valid.length : null
  }
  const totalFrontDeskHours = sum(dailyRows.map((row) => row.frontDeskHours))
  const totalFrontDeskSortingHours = sum(dailyRows.map((row) => row.frontDeskSortingEffectiveHours))

  return {
    dailyRows,
    densityRows,
    summary: {
      totalFrontDeskHours,
      totalAllocationCount: sum(dailyRows.map((row) => row.allocationCount)),
      totalSurplusFrontDeskHours: sum(dailyRows.map((row) => row.surplusFrontDeskHours ?? 0)),
      avgSaturationIndex: avgOf(dailyRows.map((row) => row.saturationIndex)),
      avgBoxesPerFrontDeskHour: avgOf(dailyRows.map((row) => row.boxesPerFrontDeskHour)),
      avgFirstAfternoonGapMinutes: avgOf(dailyRows.map((row) => row.firstAfternoonGapMinutes)),
      frontDeskSortingParticipationRate:
        totalFrontDeskHours > 0 ? totalFrontDeskSortingHours / totalFrontDeskHours : null,
      benchmarkBoxesPerFrontDeskHour,
      riskDayCount: dailyRows.filter((row) => row.status === 'idle' || row.status === 'delayed').length,
      missingFrontDeskDayCount: dailyRows.filter((row) => row.status === 'missing').length,
    },
  }
}
