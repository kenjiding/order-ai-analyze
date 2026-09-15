/**
 * 出仓率即时查询：按到件日切当天 / 次日 0–11 点，并按小时分桶。
 *
 * 口径与「出仓派签达成分析」的 11 点前出仓不同：这里的「次日」是日历 +1 天，
 * 不跳周末、不取下一个分拣工作日。派件时间空 = 未出仓。
 */
import { iMileStrToMs, localDateTimeToMs, type AusTz } from '../imile/ausTimezone'
import { isBefore11Exit } from '../imile/before11Exit'

/** 当天 00:00–24:00（24 桶）+ 次日 00:00–11:00（11 桶，最后一桶含 11:00 整点） */
export const HOUR_SLOT_COUNT = 35

export function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function enumerateDatesInclusive(startDate: string, endDate: string): string[] {
  const out: string[] = []
  const [y, m, d] = startDate.split('-').map(Number)
  const cur = new Date(Date.UTC(y, m - 1, d))
  while (true) {
    const s = cur.toISOString().slice(0, 10)
    if (s > endDate) break
    out.push(s)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

export type ExitRateTaggedRow = {
  vendorKey: string
  vendorName: string
  routeKey: string
  driverKey: string
  driverName: string
  sameDay: boolean
  nextMorning: boolean
  pending: boolean
  hourIndex: number | null
}

export type ExitRateDimRow = {
  key: string
  name: string
  total: number
  sameDay: number
  nextMorning: number
  pending: number
  byHour: number[]
}

export type ExitRateAggregate = {
  total: number
  sameDay: number
  nextMorning: number
  pending: number
  byHour: number[]
  vendors: ExitRateDimRow[]
  routes: ExitRateDimRow[]
  drivers: ExitRateDimRow[]
}

function norm(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function emptyHours(): number[] {
  return Array.from({ length: HOUR_SLOT_COUNT }, () => 0)
}

export function tagExitRateRows(
  rows: Array<Record<string, unknown>>,
  arrivalDate: string,
  tz: AusTz,
): ExitRateTaggedRow[] {
  const sameDayMs = localDateTimeToMs(`${arrivalDate} 23:59:59`, tz)
  const nextDate = addCalendarDays(arrivalDate, 1)
  const nextMorningEndMs = localDateTimeToMs(`${nextDate} 11:00:00`, tz)
  const dayStartMs = localDateTimeToMs(`${arrivalDate} 00:00:00`, tz)

  return rows.map((row) => {
    const deliveryTime =
      typeof row.deliveryTime === 'string' && row.deliveryTime ? row.deliveryTime : null
    const sameDay = isBefore11Exit(deliveryTime, sameDayMs)
    const beforeNext11 = isBefore11Exit(deliveryTime, nextMorningEndMs)
    const nextMorning = beforeNext11 && !sameDay
    const pending = !deliveryTime

    let hourIndex: number | null = null
    if (deliveryTime && beforeNext11) {
      let idx = Math.floor((iMileStrToMs(deliveryTime) - dayStartMs) / 3_600_000)
      if (idx < 0) idx = 0
      if (idx >= HOUR_SLOT_COUNT) idx = HOUR_SLOT_COUNT - 1
      hourIndex = idx
    }

    const vendorKey = norm(row.courierVendorCode)
    const routeKey = norm(row.consigneeRouteCode)
    const driverKey = norm(row.courierCode)
    return {
      vendorKey,
      vendorName: norm(row.courierVendor) || vendorKey,
      routeKey,
      driverKey,
      driverName: norm(row.courier) || driverKey,
      sameDay,
      nextMorning,
      pending,
      hourIndex,
    }
  })
}

type Acc = {
  key: string
  name: string
  total: number
  sameDay: number
  nextMorning: number
  pending: number
  byHour: number[]
}

function bump(acc: Acc, row: ExitRateTaggedRow, displayName: string) {
  acc.total += 1
  if (row.sameDay) acc.sameDay += 1
  if (row.nextMorning) acc.nextMorning += 1
  if (row.pending) acc.pending += 1
  if (row.hourIndex != null) acc.byHour[row.hourIndex] += 1
  if (displayName && (acc.name === acc.key || !acc.name)) acc.name = displayName
}

function newAcc(key: string, name: string): Acc {
  return {
    key,
    name: name || key,
    total: 0,
    sameDay: 0,
    nextMorning: 0,
    pending: 0,
    byHour: emptyHours(),
  }
}

function toDimRows(map: Map<string, Acc>): ExitRateDimRow[] {
  return [...map.values()]
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .map((acc) => ({
      key: acc.key,
      name: acc.name,
      total: acc.total,
      sameDay: acc.sameDay,
      nextMorning: acc.nextMorning,
      pending: acc.pending,
      byHour: acc.byHour,
    }))
}

export function aggregateExitRateRows(rows: ExitRateTaggedRow[]): ExitRateAggregate {
  const vendors = new Map<string, Acc>()
  const routes = new Map<string, Acc>()
  const drivers = new Map<string, Acc>()
  const byHour = emptyHours()
  let sameDay = 0
  let nextMorning = 0
  let pending = 0

  for (const row of rows) {
    if (row.sameDay) sameDay += 1
    if (row.nextMorning) nextMorning += 1
    if (row.pending) pending += 1
    if (row.hourIndex != null) byHour[row.hourIndex] += 1

    let vendor = vendors.get(row.vendorKey)
    if (!vendor) {
      vendor = newAcc(row.vendorKey, row.vendorName)
      vendors.set(row.vendorKey, vendor)
    }
    bump(vendor, row, row.vendorName)

    let route = routes.get(row.routeKey)
    if (!route) {
      route = newAcc(row.routeKey, row.routeKey)
      routes.set(row.routeKey, route)
    }
    bump(route, row, row.routeKey)

    let driver = drivers.get(row.driverKey)
    if (!driver) {
      driver = newAcc(row.driverKey, row.driverName)
      drivers.set(row.driverKey, driver)
    }
    bump(driver, row, row.driverName)
  }

  return {
    total: rows.length,
    sameDay,
    nextMorning,
    pending,
    byHour,
    vendors: toDimRows(vendors),
    routes: toDimRows(routes),
    drivers: toDimRows(drivers),
  }
}

export type ExitRateDaySlice = {
  date: string
  rows: ExitRateTaggedRow[]
}

export function buildExitRateReport(days: ExitRateDaySlice[]): {
  overall: ExitRateAggregate
  byDate: Record<string, ExitRateAggregate>
  dates: string[]
} {
  const byDate: Record<string, ExitRateAggregate> = {}
  const all: ExitRateTaggedRow[] = []
  const dates: string[] = []
  for (const day of days) {
    dates.push(day.date)
    byDate[day.date] = aggregateExitRateRows(day.rows)
    all.push(...day.rows)
  }
  return { overall: aggregateExitRateRows(all), byDate, dates }
}
