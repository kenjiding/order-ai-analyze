import type { ParsedAllocationRow, ParsedAttendanceRow } from './aggregates'
import { formatDateTime } from './formatAndParse'

const DENSITY_SLOT_MINUTES = 30

export type FrontDeskDensityAllocation = {
  driverCompany: string
  driverCode: string
  allocationTimeLabel: string
}

export function formatDensityAllocationLabel(item: FrontDeskDensityAllocation): string {
  const company = item.driverCompany.trim() || '—'
  const driverCode = item.driverCode.trim() || '—'
  const allocationTime = item.allocationTimeLabel.trim() || '—'
  return `${company}（${driverCode}） - ${allocationTime}`
}

export type FrontDeskDensityRow = {
  date: string
  timeSlot: string
  allocationCount: number
  allocations: FrontDeskDensityAllocation[]
}

export type FrontDeskClockOutDayRow = {
  date: string
  frontDeskLastClockOutSlot: string
  frontDeskLastClockOutLabel: string
  frontDeskLastClockOutPerson: string
  offDutyIdleMinutes: number | null
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

export function buildAllocationDensity(allocationRows: ParsedAllocationRow[]): FrontDeskDensityRow[] {
  if (!allocationRows.length) return []

  const densityMap = new Map<
    string,
    { date: string; slot: number; count: number; allocations: FrontDeskDensityAllocation[] }
  >()

  for (const row of allocationRows) {
    const slot = slotIndex(row.allocationTime)
    const key = `${row.date}\0${slot}`
    const allocation: FrontDeskDensityAllocation = {
      driverCompany: row.driverCompany.trim() || '—',
      driverCode: row.driverCode.trim() || '—',
      allocationTimeLabel: formatDateTime(row.allocationTime),
    }
    const existed = densityMap.get(key)
    if (existed) {
      existed.count += 1
      existed.allocations.push(allocation)
    } else {
      densityMap.set(key, { date: row.date, slot, count: 1, allocations: [allocation] })
    }
  }

  const densityRows: FrontDeskDensityRow[] = []
  Array.from(densityMap.values())
    .sort((a, b) => (a.date === b.date ? a.slot - b.slot : a.date.localeCompare(b.date)))
    .forEach((row) => {
      row.allocations.sort((a, b) => a.allocationTimeLabel.localeCompare(b.allocationTimeLabel))
      densityRows.push({
        date: row.date,
        timeSlot: slotLabel(row.slot),
        allocationCount: row.count,
        allocations: row.allocations,
      })
    })

  return densityRows
}

/** 从考勤识别前台最晚下班，并与当日最后分配时间计算分配后空档（供热力图标注）。 */
export function buildFrontDeskClockOutDays({
  attendanceRows,
  allocationRows,
}: {
  attendanceRows: ParsedAttendanceRow[]
  allocationRows: ParsedAllocationRow[]
}): FrontDeskClockOutDayRow[] {
  const frontDeskByDate = new Map<
    string,
    Array<{ outTime: Date; person: string }>
  >()
  for (const row of attendanceRows) {
    if (!row.isFrontDesk || !row.clockOutTime) continue
    if (!frontDeskByDate.has(row.date)) frontDeskByDate.set(row.date, [])
    frontDeskByDate.get(row.date)!.push({
      outTime: row.clockOutTime,
      person: row.sorterName || row.nameNick || row.nameFull || row.sorterKey,
    })
  }

  const lastAllocationByDate = new Map<string, Date>()
  for (const row of allocationRows) {
    const prev = lastAllocationByDate.get(row.date)
    if (!prev || row.allocationTime > prev) {
      lastAllocationByDate.set(row.date, row.allocationTime)
    }
  }

  const dates = new Set([...frontDeskByDate.keys(), ...lastAllocationByDate.keys()])
  return Array.from(dates)
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const clockOutRows = frontDeskByDate.get(date) ?? []
      const frontDeskLastClockOut = clockOutRows.length
        ? clockOutRows.reduce((latest, current) =>
            current.outTime > latest.outTime ? current : latest,
          clockOutRows[0]!)
        : null
      const frontDeskLastClockOutTime = frontDeskLastClockOut?.outTime ?? null
      const lastAllocationTime = lastAllocationByDate.get(date) ?? null
      const offDutyIdleMinutes =
        frontDeskLastClockOutTime && lastAllocationTime
          ? Math.max(0, (frontDeskLastClockOutTime.getTime() - lastAllocationTime.getTime()) / 60000)
          : null

      return {
        date,
        frontDeskLastClockOutSlot: frontDeskLastClockOutTime ? slotLabel(slotIndex(frontDeskLastClockOutTime)) : '',
        frontDeskLastClockOutLabel: frontDeskLastClockOutTime ? formatDateTime(frontDeskLastClockOutTime) : '—',
        frontDeskLastClockOutPerson: frontDeskLastClockOut?.person ?? '',
        offDutyIdleMinutes,
      }
    })
    .filter((row) => row.frontDeskLastClockOutSlot)
}
