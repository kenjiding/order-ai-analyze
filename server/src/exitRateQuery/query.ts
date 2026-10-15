import { fetchExitAlarmWaybillRecords } from '../imile/ofdReport'
import type { AusTz } from '../imile/ausTimezone'
import {
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
  const days: ExitRateDaySlice[] = []

  for (const dateStr of dates) {
    const fetched = await fetchExitAlarmWaybillRecords({
      token: input.token,
      stationCode: input.stationCode,
      dateStr,
      label: '出仓率查询',
    })
    if (!fetched.ok) {
      return { ok: false, status: 502, message: fetched.message }
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
