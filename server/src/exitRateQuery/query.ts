import {
  fetchSearchWaybillByNos,
  fetchWaybillDetailsByInboundIndex,
  getOrFetchInboundWaybillNos,
  getRegionNow,
} from '../imile/inboundWaybillIndex'
import type { AusTz } from '../imile/ausTimezone'
import {
  addCalendarDays,
  buildExitRateReport,
  enumerateDatesInclusive,
  tagExitRateRows,
  type ExitRateAggregate,
  type ExitRateDaySlice,
} from './aggregate'

export type ExitRateQueryResult = ExitRateAggregate & {
  stationCode: string
  startDate: string
  endDate: string
  dates: string[]
  byDate: Record<string, ExitRateAggregate>
}

export type ExitRateQueryError = {
  ok: false
  status: number
  message: string
}

export async function queryExitRates(input: {
  token: string
  stationCode: string
  startDate: string
  endDate: string
  tz: AusTz
}): Promise<{ ok: true; data: ExitRateQueryResult } | ExitRateQueryError> {
  const dates = enumerateDatesInclusive(input.startDate, input.endDate)
  const today = getRegionNow(input.tz).dateStr
  const refreshFrom = addCalendarDays(today, -1)
  const days: ExitRateDaySlice[] = []

  for (const dateStr of dates) {
    const forceRefresh = dateStr >= refreshFrom
    const fetched = forceRefresh
      ? await fetchFreshWaybillDetails({
          token: input.token,
          stationCode: input.stationCode,
          dateStr,
          tz: input.tz,
        })
      : await fetchWaybillDetailsByInboundIndex({
          token: input.token,
          stationCode: input.stationCode,
          dateStr,
          label: '出仓率查询',
          tz: input.tz,
        })
    if (!fetched.ok) {
      return { ok: false, status: fetched.status ?? 502, message: fetched.message }
    }
    days.push({
      date: dateStr,
      rows: tagExitRateRows(fetched.records as Array<Record<string, unknown>>, dateStr, input.tz),
    })
  }

  const report = buildExitRateReport(days)
  return {
    ok: true,
    data: {
      ...report.overall,
      stationCode: input.stationCode,
      startDate: input.startDate,
      endDate: input.endDate,
      dates: report.dates,
      byDate: report.byDate,
    },
  }
}

/** 昨天/今天强制重拉到件索引，避免半截缓存当分母。更早的日期复用已有索引。 */
async function fetchFreshWaybillDetails(input: {
  token: string
  stationCode: string
  dateStr: string
  tz: AusTz
}) {
  const index = await getOrFetchInboundWaybillNos({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    label: '出仓率查询 到件索引',
    forceRefresh: true,
  })
  if (!index.ok) return index
  return fetchSearchWaybillByNos({
    token: input.token,
    stationCode: input.stationCode,
    dateStr: input.dateStr,
    waybillNos: index.waybillNos,
    label: '出仓率查询',
    tz: input.tz,
  })
}
