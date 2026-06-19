import type { ScanSettings } from './constants'
import { isCainiaoWaybill } from './cainiaoWaybill'
import { dayjs } from './dayjsSetup'
import { formatDateKey } from './formatAndParse'
import { COARSE_STAGE_SPAN_SPLIT_THRESHOLD_MINUTES } from './coarseStageHours'
import { computeSessions, computeSpanMinutes } from './sessions'

const padHour = (n: number) => String(n).padStart(2, '0')
/**
 * 修正效率可靠度阈值：对齐「一级分拣同人同日的扫描量 / 会话推算有效工时」的典型水平（不是考勤满班时长）。
 * 校准脚本：`npm exec tsx scripts/calibrateScannerReliabilityBases.ts`（当前默认合并 temp 下两半月中到件表；已排除 System、ADL-shigong8，并剔除整期总扫描<200的扫描员；基数取人-日 P50）。
 */
const SCANNER_RELIABILITY_BASE_SCAN_COUNT = 1100
const SCANNER_RELIABILITY_BASE_EFFECTIVE_HOURS = 2.35

/**
 * 菜鸟件相对普通件的分拣难度比率（0~1）。
 * 0.75 表示菜鸟件仅需普通件 75% 的时间/精力，差值 0.25 即为"难度折扣幅度"。
 * 该值用于按菜鸟占比对扫描员效率做难度归一化修正。
 */
const CAINIAO_DIFFICULTY_RATIO = 0.75

/** 自然小时区间标签，与 dayjs 本地时区一致；23 点为 23:00–24:00。 */
export const scannerHourSlotLabel = (hour: number): string => {
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return ''
  return hour === 23 ? `${padHour(23)}:00–24:00` : `${padHour(hour)}:00–${padHour(hour + 1)}:00`
}

export type ParsedScanRow = {
  /** 扫描时间（Excel）/ scanDate（API） */
  scanTime: Date
  /** 运单号 / waybillNo */
  trackingNumber: string
  /** 扫描员 / operator；System 等账号置空，仍计入货量 */
  scanner: string
  routeCode: string
  consigneeZipCode: string
  deliveryStation: string
  scanStation: string
  clientCode: string
  clientName: string
  /** 收件人城市 / city */
  consigneeCity: string
  sortingScanTime: Date | null
  sortingTrackingNumber: string
  sortingScanner: string
  sortingEligible: boolean
  sourceFileName: string
  sourceSheetName: string
  sourceRowNumber: number
}

export function waybillDedupeKey(row: ParsedScanRow): string {
  return row.sortingTrackingNumber.trim() || row.trackingNumber.trim()
}

/** 必须先按运单号去再参与货量与个人效率统计；返回值用于统计的行集，丢弃条数为重复运单较晚记录 */
export function dedupeParsedScanRowsByWaybill(rows: ParsedScanRow[]): {
  rows: ParsedScanRow[]
  duplicateDropped: number
} {
  type Keyed = { row: ParsedScanRow; ix: number; time: number; file: string; sheet: string; line: number }
  const keyed: Keyed[] = rows.map((row, ix) => ({
    row,
    ix,
    time: (row.sortingScanTime ?? row.scanTime).getTime(),
    file: row.sourceFileName,
    sheet: row.sourceSheetName,
    line: row.sourceRowNumber,
  }))

  keyed.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time
    const c = String(a.file).localeCompare(String(b.file), 'zh')
    if (c !== 0) return c
    const cs = String(a.sheet).localeCompare(String(b.sheet), 'zh')
    if (cs !== 0) return cs
    if (a.line !== b.line) return a.line - b.line
    return a.ix - b.ix
  })

  const seen = new Set<string>()
  const out: ParsedScanRow[] = []

  for (const { row } of keyed) {
    const k = waybillDedupeKey(row)
    if (!k) {
      out.push(row)
      continue
    }
    if (seen.has(k)) continue
    seen.add(k)
    out.push(row)
  }

  return { rows: out, duplicateDropped: rows.length - out.length }
}

export function attendancePersonDayDedupeKey(row: ParsedAttendanceRow): string {
  return `${row.date}|${row.sorterKey}`
}

/** 同人同日重复记录保留最早一条，避免叠加上传时工时与工资重复计入 */
export function dedupeParsedAttendanceRowsByPersonDay(rows: ParsedAttendanceRow[]): {
  rows: ParsedAttendanceRow[]
  duplicateDropped: number
} {
  type Keyed = { row: ParsedAttendanceRow; ix: number; file: string; sheet: string; line: number }
  const keyed: Keyed[] = rows.map((row, ix) => ({
    row,
    ix,
    file: row.sourceFileName,
    sheet: row.sourceSheetName,
    line: row.sourceRowNumber,
  }))

  keyed.sort((a, b) => {
    const dateCmp = a.row.date.localeCompare(b.row.date)
    if (dateCmp !== 0) return dateCmp
    const keyCmp = a.row.sorterKey.localeCompare(b.row.sorterKey, 'zh')
    if (keyCmp !== 0) return keyCmp
    const c = String(a.file).localeCompare(String(b.file), 'zh')
    if (c !== 0) return c
    const cs = String(a.sheet).localeCompare(String(b.sheet), 'zh')
    if (cs !== 0) return cs
    if (a.line !== b.line) return a.line - b.line
    return a.ix - b.ix
  })

  const seen = new Set<string>()
  const out: ParsedAttendanceRow[] = []

  for (const { row } of keyed) {
    const k = attendancePersonDayDedupeKey(row)
    if (!k || k.endsWith('|')) {
      out.push(row)
      continue
    }
    if (seen.has(k)) continue
    seen.add(k)
    out.push(row)
  }

  return { rows: out, duplicateDropped: rows.length - out.length }
}

export type ParsedAttendanceRow = {
  date: string
  sorterKey: string
  sorterName: string
  nameNick: string
  nameFull: string
  hours: number
  clockInTime?: Date | null
  clockOutTime?: Date | null
  positionTitle?: string
  positionCode?: string
  isFrontDesk: boolean
  isSorterWorker: boolean
  /** 与工资考勤表「工作日」列一致，用于时薪档次 */
  workday?: string
  /** 与工资考勤表「姓氏」列一致（如前台卡） */
  surname?: string
  sourceFileName: string
  sourceSheetName: string
  sourceRowNumber: number
}

export type ParsedAllocationRow = {
  allocationTime: Date
  date: string
  timeSlot: string
  boxNo: string
  driver: string
  driverCompany: string
  driverCode: string
  sourceFileName: string
  sourceSheetName: string
  sourceRowNumber: number
}

export const buildScanAggregate = (rows: ParsedScanRow[]) => {
  const dailyMap = new Map<
    string,
    { date: string; uniqueSet: Set<string>; cainiaoSet: Set<string>; scannerSet: Set<string> }
  >()

  rows.forEach((row, index) => {
    const dateKey = formatDateKey(row.scanTime)
    if (!dateKey) return

    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, {
        date: dateKey,
        uniqueSet: new Set(),
        cainiaoSet: new Set(),
        scannerSet: new Set(),
      })
    }

    const bucket = dailyMap.get(dateKey)!
    const volumeKey = row.trackingNumber || `__row_${index}`
    bucket.uniqueSet.add(volumeKey)
    if (isCainiaoWaybill(volumeKey)) {
      bucket.cainiaoSet.add(volumeKey)
    }
    if (row.scanner) {
      bucket.scannerSet.add(row.scanner)
    }
  })

  const dailyRows = Array.from(dailyMap.values())
    .map((row) => {
      const volume = row.uniqueSet.size
      const cainiaoVolume = row.cainiaoSet.size
      return {
        date: row.date,
        volume,
        cainiaoVolume,
        cainiaoShare: volume > 0 ? cainiaoVolume / volume : 0,
        scannerCount: row.scannerSet.size,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  const totalVolume = dailyRows.reduce((sum, row) => sum + row.volume, 0)
  const totalCainiaoVolume = dailyRows.reduce((sum, row) => sum + row.cainiaoVolume, 0)

  return {
    dailyRows,
    dailyMap,
    summary: {
      totalVolume,
      totalCainiaoVolume,
      cainiaoShareWindow: totalVolume > 0 ? totalCainiaoVolume / totalVolume : 0,
      totalDays: dailyRows.length,
      hasScanner: rows.some((row) => Boolean(row.scanner)),
    },
  }
}

export const buildAttendanceAggregate = (rows: ParsedAttendanceRow[], openDayThreshold: number) => {
  const dailyMap = new Map<
    string,
    { date: string; totalHours: number; sorterKeySet: Set<string>; sorterNameSet: Set<string> }
  >()

  rows.forEach((row) => {
    if (!dailyMap.has(row.date)) {
      dailyMap.set(row.date, {
        date: row.date,
        totalHours: 0,
        sorterKeySet: new Set(),
        sorterNameSet: new Set(),
      })
    }

    const bucket = dailyMap.get(row.date)!
    bucket.totalHours += row.hours
    bucket.sorterKeySet.add(row.sorterKey)
    bucket.sorterNameSet.add(row.sorterName)
  })

  const dailyRows = Array.from(dailyMap.values())
    .map((row) => ({
      date: row.date,
      totalHours: row.totalHours,
      sorterCount: row.sorterKeySet.size,
      sorterNames: Array.from(row.sorterNameSet).filter(Boolean).join('、'),
      isOpenDay: row.sorterKeySet.size > openDayThreshold,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const openDayCount = dailyRows.filter((row) => row.isOpenDay).length
  const totalHours = dailyRows.reduce((sum, row) => sum + row.totalHours, 0)

  return {
    dailyRows,
    dailyMap: new Map(dailyRows.map((row) => [row.date, row])),
    summary: {
      totalHours,
      totalDays: dailyRows.length,
      openDayCount,
    },
    rawRows: rows,
  }
}

export type ScanAggregate = ReturnType<typeof buildScanAggregate>
export type AttendanceAggregate = ReturnType<typeof buildAttendanceAggregate>

export type AttendanceEfficiencyResult = NonNullable<ReturnType<typeof buildAttendanceEfficiency>>

export function buildAttendanceEfficiency(
  scanAggregate: ScanAggregate | null,
  attendanceAggregate: AttendanceAggregate | null,
) {
  if (!scanAggregate || !scanAggregate.dailyRows.length || !attendanceAggregate) return null

  const scanDatesSorted = scanAggregate.dailyRows.map((r) => r.date).sort((a, b) => a.localeCompare(b))
  const rangeStart = scanDatesSorted[0]
  const maxScan = scanDatesSorted[scanDatesSorted.length - 1]
  const attDatesGte = attendanceAggregate.dailyRows.map((r) => r.date).filter((d) => d >= rangeStart)
  const maxAttGte = attDatesGte.length ? attDatesGte.reduce((a, b) => (a > b ? a : b)) : maxScan
  const rangeEnd = maxScan > maxAttGte ? maxScan : maxAttGte

  const scanDateSet = new Set(scanAggregate.dailyRows.map((r) => r.date))

  const fromScan = scanAggregate.dailyRows.map((scanDay) => {
    const attendance = attendanceAggregate.dailyMap.get(scanDay.date)
    const totalHours = attendance ? attendance.totalHours : 0
    const sorterCount = attendance ? attendance.sorterCount : 0
    const isOpenDay = attendance ? attendance.isOpenDay : false

    return {
      date: scanDay.date,
      volume: scanDay.volume,
      cainiaoVolume: scanDay.cainiaoVolume,
      cainiaoShare: scanDay.cainiaoShare,
      sorterCount,
      totalHours,
      isOpenDay,
      hasAttendance: Boolean(attendance),
      dayEfficiency: totalHours > 0 ? scanDay.volume / totalHours : null,
      isAttendanceOnly: false,
    }
  })

  const attendanceOnlyInWindow: typeof fromScan = []
  attendanceAggregate.dailyRows.forEach((row) => {
    if (row.date < rangeStart || row.date > rangeEnd) return
    if (scanDateSet.has(row.date)) return
    attendanceOnlyInWindow.push({
      date: row.date,
      volume: 0,
      cainiaoVolume: 0,
      cainiaoShare: 0,
      sorterCount: row.sorterCount,
      totalHours: row.totalHours,
      isOpenDay: row.isOpenDay,
      hasAttendance: true,
      dayEfficiency: null,
      isAttendanceOnly: true,
    })
  })

  const dailyRows = [...fromScan, ...attendanceOnlyInWindow].sort((a, b) => a.date.localeCompare(b.date))

  const matchedRows = dailyRows.filter((row) => row.hasAttendance)
  const matchedDateSet = new Set(matchedRows.map((row) => row.date))
  const matchedVolume = matchedRows.reduce((sum, row) => sum + row.volume, 0)
  const intersectionMatchHours = dailyRows
    .filter((row) => row.hasAttendance && !row.isAttendanceOnly)
    .reduce((sum, row) => sum + row.totalHours, 0)
  const openDayVolume = matchedRows.filter((row) => row.isOpenDay).reduce((sum, row) => sum + row.volume, 0)

  let allHours = 0
  let openHours = 0
  let openDayCountInWindow = 0
  attendanceAggregate.dailyRows.forEach((row) => {
    if (row.date < rangeStart || row.date > rangeEnd) return
    allHours += row.totalHours
    if (row.isOpenDay) {
      openHours += row.totalHours
      openDayCountInWindow += 1
    }
  })

  const openDayCount = openDayCountInWindow
  const uploadedVolume = scanAggregate.summary.totalVolume
  const totalCainiaoVolume = scanAggregate.summary.totalCainiaoVolume
  const cainiaoShareWindow = scanAggregate.summary.cainiaoShareWindow
  let openDayCainiaoVolume = 0
  let openDayVolumeForCainiao = 0
  for (const row of matchedRows) {
    if (!row.isOpenDay) continue
    openDayCainiaoVolume += row.cainiaoVolume
    openDayVolumeForCainiao += row.volume
  }
  const cainiaoShareOpenDays =
    openDayVolumeForCainiao > 0 ? openDayCainiaoVolume / openDayVolumeForCainiao : 0

  const personMap = new Map<
    string,
    {
      sorterKey: string
      sorterName: string
      totalHours: number
      activeDateSet: Set<string>
      openDaySet: Set<string>
      matchNames: Set<string>
    }
  >()

  const openDayLookup = new Map(matchedRows.map((row) => [row.date, row.isOpenDay]))

  attendanceAggregate.rawRows.forEach((row) => {
    if (!matchedDateSet.has(row.date)) return

    if (!personMap.has(row.sorterKey)) {
      personMap.set(row.sorterKey, {
        sorterKey: row.sorterKey,
        sorterName: row.sorterName || row.sorterKey,
        totalHours: 0,
        activeDateSet: new Set(),
        openDaySet: new Set(),
        matchNames: new Set(),
      })
    }

    const person = personMap.get(row.sorterKey)!
    person.totalHours += row.hours
    person.activeDateSet.add(row.date)
    if (openDayLookup.get(row.date)) {
      person.openDaySet.add(row.date)
    }
    ;[row.sorterName, row.sorterKey, row.nameNick, row.nameFull].forEach((t) => {
      const s = String(t ?? '').trim()
      if (s) person.matchNames.add(s)
    })
  })

  const personRows = Array.from(personMap.values())
    .map((person) => ({
      sorterKey: person.sorterKey,
      sorterName: person.sorterName,
      totalHours: person.totalHours,
      activeDays: person.activeDateSet.size,
      openDays: person.openDaySet.size,
      efficiencyMatchNames: Array.from(person.matchNames),
    }))
    .sort((a, b) => b.totalHours - a.totalHours)

  const attendanceDateSet = new Set<string>()
  attendanceAggregate.rawRows.forEach((r) => {
    if (r.date) attendanceDateSet.add(r.date)
  })
  const attendanceOnlyDates = Array.from(attendanceDateSet)
    .filter((d) => !scanDateSet.has(d))
    .sort((a, b) => a.localeCompare(b))

  const attendanceSheetDaily = attendanceAggregate.dailyRows
  const attendanceSheetRangeStart = attendanceSheetDaily[0]?.date ?? rangeStart
  const attendanceSheetRangeEnd =
    attendanceSheetDaily.length > 0 ? attendanceSheetDaily[attendanceSheetDaily.length - 1].date : rangeEnd

  return {
    dailyRows,
    personRows,
    summary: {
      uploadedVolume,
      efficiencyRangeStart: rangeStart,
      efficiencyRangeEnd: rangeEnd,
      attendanceSheetRangeStart,
      attendanceSheetRangeEnd,
      matchedVolume,
      intersectionMatchHours,
      allHours,
      openHours,
      openDayVolume,
      openDayCount,
      matchedDayCount: matchedRows.length,
      unmatchedDayCount: dailyRows.filter((row) => !row.hasAttendance).length,
      unmatchedDates: dailyRows.filter((row) => !row.hasAttendance).map((row) => row.date),
      attendanceOnlyDates,
      attendanceOnlyDateCount: attendanceOnlyDates.length,
      attendanceOnlyInWindowCount: attendanceOnlyInWindow.length,
      openEfficiency: openHours > 0 ? uploadedVolume / openHours : 0,
      overallEfficiency: allHours > 0 ? uploadedVolume / allHours : 0,
      openDayVolumeEfficiency: openHours > 0 ? openDayVolume / openHours : 0,
      totalCainiaoVolume,
      cainiaoShareWindow,
      cainiaoShareOpenDays,
    },
  }
}

export type AttendanceDailyMatchRow = AttendanceEfficiencyResult['dailyRows'][number]

/** 「日期匹配明细」末行：含各列总计与按日算术平均；效率「总计」= 表内总货量÷总工时之和，「平均」= 各日有值效率的算术平均 */
export function computeAttendanceDailyMatchAverages(dailyRows: AttendanceDailyMatchRow[]) {
  const n = dailyRows.length
  if (!n) {
    return {
      avgVolume: 0,
      avgTotalHours: 0,
      avgDayEfficiency: null as number | null,
      dayEfficiencySampleCount: 0,
      totalVolume: 0,
      totalCainiaoVolume: 0,
      avgCainiaoVolume: 0,
      cainiaoShareFromTotals: null as number | null,
      avgCainiaoShare: null as number | null,
      totalHoursSum: 0,
      efficiencyFromTotals: null as number | null,
    }
  }
  let sumVolume = 0
  let sumCainiao = 0
  let sumHours = 0
  let effSum = 0
  let effCount = 0
  let shareSum = 0
  let shareCount = 0
  for (const row of dailyRows) {
    sumVolume += row.volume
    sumCainiao += row.cainiaoVolume
    sumHours += row.totalHours
    if (row.dayEfficiency != null) {
      effSum += row.dayEfficiency
      effCount += 1
    }
    if (row.volume > 0) {
      shareSum += row.cainiaoShare
      shareCount += 1
    }
  }
  return {
    avgVolume: sumVolume / n,
    avgTotalHours: sumHours / n,
    avgDayEfficiency: effCount > 0 ? effSum / effCount : null,
    dayEfficiencySampleCount: effCount,
    totalVolume: sumVolume,
    totalCainiaoVolume: sumCainiao,
    avgCainiaoVolume: sumCainiao / n,
    cainiaoShareFromTotals: sumVolume > 0 ? sumCainiao / sumVolume : null,
    avgCainiaoShare: shareCount > 0 ? shareSum / shareCount : null,
    totalHoursSum: sumHours,
    efficiencyFromTotals: sumHours > 0 ? sumVolume / sumHours : null,
  }
}

/** 按日覆盖「效率明细/天」总工时后，重算当日效率与窗口内汇总口径（开仓/总体效率、交集工时等）。 */
export function applyAttendanceDailyHoursOverrides(
  result: AttendanceEfficiencyResult,
  overrides: Record<string, number>,
): AttendanceEfficiencyResult {
  if (!Object.keys(overrides).length) return result

  const rangeStart = result.summary.efficiencyRangeStart
  const rangeEnd = result.summary.efficiencyRangeEnd
  const uploadedVolume = result.summary.uploadedVolume

  const dailyRows = result.dailyRows.map((row) => {
    const forced = overrides[row.date]
    if (forced === undefined) return row
    if (!Number.isFinite(forced) || forced < 0) return row
    const totalHours = forced
    const dayEfficiency =
      row.isAttendanceOnly || totalHours <= 0 ? null : row.volume / totalHours
    return { ...row, totalHours, dayEfficiency }
  })

  let allHours = 0
  let openHours = 0
  let openDayCountInWindow = 0
  for (const row of dailyRows) {
    if (row.date < rangeStart || row.date > rangeEnd || !row.hasAttendance) continue
    allHours += row.totalHours
    if (row.isOpenDay) {
      openHours += row.totalHours
      openDayCountInWindow += 1
    }
  }

  const intersectionMatchHours = dailyRows
    .filter((row) => row.hasAttendance && !row.isAttendanceOnly)
    .reduce((sum, row) => sum + row.totalHours, 0)

  const openDayVolume = result.summary.openDayVolume

  return {
    ...result,
    dailyRows,
    summary: {
      ...result.summary,
      allHours,
      openHours,
      openDayCount: openDayCountInWindow,
      intersectionMatchHours,
      openEfficiency: openHours > 0 ? uploadedVolume / openHours : 0,
      overallEfficiency: allHours > 0 ? uploadedVolume / allHours : 0,
      openDayVolumeEfficiency: openHours > 0 ? openDayVolume / openHours : 0,
    },
  }
}

export type ScannerEfficiencyResult = NonNullable<ReturnType<typeof buildScannerEfficiency>>

export function buildScannerEfficiency(rows: ParsedScanRow[], settings: ScanSettings) {
  const validRows = rows
    .filter((row) => row.sortingEligible)
    .map((row) => ({
      ...row,
      scanTime: row.sortingScanTime!,
      scanner: row.sortingScanner,
      trackingNumber: row.sortingTrackingNumber,
    }))
  if (!validRows.length) return null

  const hourlyAcc = new Map<string, { date: string; hour: number; scanner: string; scanCount: number }>()
  const scannerDayScanTotals = new Map<string, number>()

  for (const row of validRows) {
    const dateKey = formatDateKey(row.scanTime)
    if (!dateKey) continue
    const hour = dayjs(row.scanTime).hour()
    const slotKey = `${dateKey}\0${hour}\0${row.scanner}`
    const existed = hourlyAcc.get(slotKey)
    if (existed) {
      existed.scanCount += 1
    } else {
      hourlyAcc.set(slotKey, { date: dateKey, hour, scanner: row.scanner, scanCount: 1 })
    }
    const dayScannerKey = `${dateKey}__${row.scanner}`
    scannerDayScanTotals.set(dayScannerKey, (scannerDayScanTotals.get(dayScannerKey) ?? 0) + 1)
  }

  // 有效扫描员-日集合：日扫描量 >= minDayScanCount 才纳入统计
  const validScannerDayKeys = new Set<string>()
  scannerDayScanTotals.forEach((total, key) => {
    if (total >= settings.minDayScanCount) validScannerDayKeys.add(key)
  })

  const scannerHourlyRows = Array.from(hourlyAcc.values())
    .filter((item) => validScannerDayKeys.has(`${item.date}__${item.scanner}`))
    .map((item) => {
      const dayScannerKey = `${item.date}__${item.scanner}`
      const dayTotal = scannerDayScanTotals.get(dayScannerKey) ?? 0
      const pctOfScannerDay = dayTotal > 0 ? (item.scanCount / dayTotal) * 100 : 0
      return {
        date: item.date,
        hour: item.hour,
        timeSlot: scannerHourSlotLabel(item.hour),
        scanner: item.scanner,
        scanCount: item.scanCount,
        pctOfScannerDay,
      }
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      if (a.hour !== b.hour) return a.hour - b.hour
      return a.scanner.localeCompare(b.scanner, 'zh')
    })

  const dailyScannerMap = new Map<string, { date: string; scanner: string; records: typeof validRows }>()

  validRows.forEach((row) => {
    const dateKey = formatDateKey(row.scanTime)
    const groupKey = `${dateKey}__${row.scanner}`

    if (!dailyScannerMap.has(groupKey)) {
      dailyScannerMap.set(groupKey, {
        date: dateKey,
        scanner: row.scanner,
        records: [],
      })
    }

    dailyScannerMap.get(groupKey)!.records.push(row)
  })

  const dailyScannerRows: Array<{
    date: string
    scanner: string
    scanCount: number
    cainiaoScanCount: number
    sessionCount: number
    effectiveMinutes: number
    effectiveHours: number
    spanMinutes: number
    efficiency: number
    firstScan: Date
    lastScan: Date
    cappedGapCount: number
  }> = []

  const dailyDateMap = new Map<
    string,
    { date: string; scanCount: number; effectiveMinutes: number; scannerSet: Set<string> }
  >()
  const scannerTotalMap = new Map<
    string,
    { scanner: string; scanCount: number; cainiaoCount: number; effectiveMinutes: number; activeDateSet: Set<string> }
  >()

  dailyScannerMap.forEach((group) => {
    // 脏数据过滤：该扫描员当日扫描量低于阈值则跳过
    if (!validScannerDayKeys.has(`${group.date}__${group.scanner}`)) return

    const sessions = computeSessions(group.records, settings)
    const scanCount = group.records.length
    const effectiveMinutes = sessions.reduce((sum, session) => sum + session.effectiveMinutes, 0)
    const spanMinutes = computeSpanMinutes(group.records, COARSE_STAGE_SPAN_SPLIT_THRESHOLD_MINUTES)
    const cappedGapCount = sessions.reduce((sum, session) => sum + session.cappedGapCount, 0)
    const firstScan = group.records.reduce(
      (min, record) => (record.scanTime < min ? record.scanTime : min),
      group.records[0].scanTime,
    )
    const lastScan = group.records.reduce(
      (max, record) => (record.scanTime > max ? record.scanTime : max),
      group.records[0].scanTime,
    )
    const efficiency = effectiveMinutes > 0 ? scanCount / (effectiveMinutes / 60) : 0
    const cainiaoScanCount = group.records.filter((r) => isCainiaoWaybill(r.trackingNumber)).length

    const dailyRow = {
      date: group.date,
      scanner: group.scanner,
      scanCount,
      cainiaoScanCount,
      sessionCount: sessions.length,
      effectiveMinutes,
      effectiveHours: effectiveMinutes / 60,
      spanMinutes,
      efficiency,
      firstScan,
      lastScan,
      cappedGapCount,
    }

    dailyScannerRows.push(dailyRow)

    if (!dailyDateMap.has(group.date)) {
      dailyDateMap.set(group.date, {
        date: group.date,
        scanCount: 0,
        effectiveMinutes: 0,
        scannerSet: new Set(),
      })
    }

    const dailySummary = dailyDateMap.get(group.date)!
    dailySummary.scanCount += scanCount
    dailySummary.effectiveMinutes += effectiveMinutes
    dailySummary.scannerSet.add(group.scanner)

    if (!scannerTotalMap.has(group.scanner)) {
      scannerTotalMap.set(group.scanner, {
        scanner: group.scanner,
        scanCount: 0,
        cainiaoCount: 0,
        effectiveMinutes: 0,
        activeDateSet: new Set(),
      })
    }

    const scannerTotal = scannerTotalMap.get(group.scanner)!
    scannerTotal.scanCount += scanCount
    scannerTotal.cainiaoCount += group.records.filter((r) => isCainiaoWaybill(r.trackingNumber)).length
    scannerTotal.effectiveMinutes += effectiveMinutes
    scannerTotal.activeDateSet.add(group.date)
  })

  const dailySummaryRows = Array.from(dailyDateMap.values())
    .map((item) => ({
      date: item.date,
      scanCount: item.scanCount,
      scannerCount: item.scannerSet.size,
      effectiveHours: item.effectiveMinutes / 60,
      efficiency: item.effectiveMinutes > 0 ? item.scanCount / (item.effectiveMinutes / 60) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const totalScanCount = dailySummaryRows.reduce((sum, row) => sum + row.scanCount, 0)
  const totalEffectiveHours = dailySummaryRows.reduce((sum, row) => sum + row.effectiveHours, 0)
  const totalEfficiency = totalEffectiveHours > 0 ? totalScanCount / totalEffectiveHours : 0

  // Step 1: 计算团队整体菜鸟占比（以各扫描员扫描量为权重的加权均值）
  let totalScanCountAll = 0
  let totalCainiaoCountAll = 0
  scannerTotalMap.forEach((item) => {
    totalScanCountAll += item.scanCount
    totalCainiaoCountAll += item.cainiaoCount
  })
  const cainiaoShareTeam = totalScanCountAll > 0 ? totalCainiaoCountAll / totalScanCountAll : 0
  // 团队平均难度指数：菜鸟件按 CAINIAO_DIFFICULTY_RATIO 折算难度
  const difficultyTeam = 1 - (1 - CAINIAO_DIFFICULTY_RATIO) * cainiaoShareTeam

  // Step 2: 按个人菜鸟占比计算难度修正因子，并得到菜鸟修正后的效率
  const scannerTotalRows = Array.from(scannerTotalMap.values())
    .map((item) => {
      const effectiveHours = item.effectiveMinutes / 60
      const activeDays = item.activeDateSet.size
      const efficiency = effectiveHours > 0 ? item.scanCount / effectiveHours : 0
      const scanWeight = Math.min(item.scanCount / SCANNER_RELIABILITY_BASE_SCAN_COUNT, 1)
      // 用日均有效工时而非累计总工时，避免多天短班累积后权重虚高（疲劳优势未被修正）
      const avgDailyEffectiveHours = activeDays > 0 ? effectiveHours / activeDays : 0
      const hourWeight = Math.min(avgDailyEffectiveHours / SCANNER_RELIABILITY_BASE_EFFECTIVE_HOURS, 1)
      const reliabilityWeight = scanWeight * hourWeight
      const adjustedEfficiency = efficiency * reliabilityWeight + totalEfficiency * (1 - reliabilityWeight)

      // 菜鸟难度归一化修正
      const cainiaoScanCount = item.cainiaoCount
      const cainiaoShare = item.scanCount > 0 ? cainiaoScanCount / item.scanCount : 0
      const difficultyI = 1 - (1 - CAINIAO_DIFFICULTY_RATIO) * cainiaoShare
      const rawFactor = difficultyTeam > 0 ? difficultyI / difficultyTeam : 1
      // 软限制 ±20%，防止极端菜鸟占比差异引起过度修正
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
      // 与「扫描员一级分拣效率汇总」口径一致：仅统计通过最小日扫描量过滤后仍有有效样本的扫描员。
      totalScanners: scannerTotalMap.size,
    },
  }
}

export type ScannerHourlyPivotDay = {
  date: string
  /** 本日全表合计大于 0 的小时（0–23），升序；透视列仅含这些时段。 */
  hours: number[]
  /** byHour[i] 与 hours[i] 对应 */
  scannerRows: Array<{ scanner: string; byHour: number[]; dayTotal: number }>
  /** 与 hours 下标对齐的列合计 */
  columnTotals: number[]
  grandTotal: number
}

/** 按日期拆分：仅含当日有扫描的小时列，行 扫描员 + 末行时段合计。 */
export function buildScannerHourlyPivotByDate(
  hourlyRows: Array<{ date: string; hour: number; scanner: string; scanCount: number }>,
): ScannerHourlyPivotDay[] {
  const byDate = new Map<string, Map<string, Map<number, number>>>()

  for (const row of hourlyRows) {
    if (!byDate.has(row.date)) byDate.set(row.date, new Map())
    const dateMap = byDate.get(row.date)!
    if (!dateMap.has(row.scanner)) dateMap.set(row.scanner, new Map())
    const hourMap = dateMap.get(row.scanner)!
    hourMap.set(row.hour, (hourMap.get(row.hour) ?? 0) + row.scanCount)
  }

  const dates = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b))

  return dates.map((date) => {
    const dateMap = byDate.get(date)!
    const scanners = Array.from(dateMap.keys()).sort((a, b) => a.localeCompare(b, 'zh'))
    const columnTotals24 = Array.from({ length: 24 }, () => 0)

    const scannerRowsFull = scanners.map((scanner) => {
      const hourMap = dateMap.get(scanner)!
      const byHour24 = Array.from({ length: 24 }, (_, h) => hourMap.get(h) ?? 0)
      const dayTotal = byHour24.reduce((sum, n) => sum + n, 0)
      byHour24.forEach((n, h) => {
        columnTotals24[h] += n
      })
      return { scanner, byHour24, dayTotal }
    })

    const hours = columnTotals24.map((t, h) => (t > 0 ? h : -1)).filter((h) => h >= 0)

    const scannerRows = scannerRowsFull.map(({ scanner, byHour24, dayTotal }) => ({
      scanner,
      byHour: hours.map((h) => byHour24[h]),
      dayTotal,
    }))

    const columnTotals = hours.map((h) => columnTotals24[h])
    const grandTotal = columnTotals24.reduce((sum, n) => sum + n, 0)
    return { date, hours, scannerRows, columnTotals, grandTotal }
  })
}
