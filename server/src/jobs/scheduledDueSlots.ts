import { getRegionNow } from '../imile/inboundWaybillIndex'
import type { AusTz } from '../imile/ausTimezone'
import { formatScheduledPushSlotKey } from './scheduledClaim'

const DEFAULT_CATCH_UP_MINUTES = 15
const MAX_CATCH_UP_MINUTES = 120

type PushTimeSlot = { time: string }

export type DueScheduledSlot = {
  weekday: number
  timeHHmm: string
  dateStr: string
  prevDateStr: string
  dayBeforeDateStr: string
}

function readCatchUpMinutes(): number {
  const raw = Number(process.env.SCHEDULED_PUSH_CATCH_UP_MINUTES ?? DEFAULT_CATCH_UP_MINUTES)
  if (!Number.isFinite(raw)) return DEFAULT_CATCH_UP_MINUTES
  return Math.min(MAX_CATCH_UP_MINUTES, Math.max(0, Math.floor(raw)))
}

function configuredTimes(pushTimes: PushTimeSlot[]): Set<string> {
  return new Set(
    pushTimes
      .map((slot) => slot.time?.trim())
      .filter((time): time is string => /^\d{2}:\d{2}$/.test(time)),
  )
}

/**
 * node-cron can miss minute ticks while the worker is busy with large station pulls.
 * Treat schedules as durable time slots and catch up recent unclaimed slots instead
 * of relying on the worker waking up in the exact configured minute.
 */
export function resolveDueScheduledSlots(params: {
  tz: AusTz
  weekdays: number[]
  pushTimes: PushTimeSlot[]
  now?: Date
}): DueScheduledSlot[] {
  const allowedWeekdays = new Set(params.weekdays)
  const allowedTimes = configuredTimes(params.pushTimes)
  if (allowedWeekdays.size === 0 || allowedTimes.size === 0) return []

  const nowMs = (params.now ?? new Date()).getTime()
  const catchUpMinutes = readCatchUpMinutes()
  const seen = new Set<string>()
  const due: DueScheduledSlot[] = []

  for (let offset = catchUpMinutes; offset >= 0; offset -= 1) {
    const candidate = getRegionNow(params.tz, new Date(nowMs - offset * 60_000))
    if (!allowedWeekdays.has(candidate.weekday)) continue
    if (!allowedTimes.has(candidate.timeHHmm)) continue

    const slotKey = formatScheduledPushSlotKey(candidate)
    if (seen.has(slotKey)) continue
    seen.add(slotKey)
    due.push(candidate)
  }

  return due
}
