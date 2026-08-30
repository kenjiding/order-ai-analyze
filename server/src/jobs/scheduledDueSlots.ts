import { getRegionNow, localToUtcMs } from '../imile/inboundWaybillIndex'
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
 *
 * 补跑窗口只用来兜底「worker 漏跑」，不能用来补发「配置还没生效的时间槽」：
 * effectiveSince（= schedule.updatedAt）给补跑扫描加下界，早于该分钟的时间槽一律不算 due。
 * 否则用户在 11:05 打开「启用」或改星期/时间点保存后，11:00 这个从未生效过的槽位会被
 * 立刻判定为漏跑并补发一条，卡片标题还按槽位时刻渲染成「11:00 …」，看起来像凭空重复推送。
 */
export function resolveDueScheduledSlots(params: {
  tz: AusTz
  weekdays: number[]
  pushTimes: PushTimeSlot[]
  now?: Date
  /** 配置最后一次保存的时刻；早于其所在分钟的时间槽不补发。不传则不设下界（仅供测试/无配置来源的调用） */
  effectiveSince?: Date | null
  /** 日志前缀，用于把「因配置刚变更而跳过补发」显性打出来，避免被当成静默丢推送 */
  label?: string
}): DueScheduledSlot[] {
  const allowedWeekdays = new Set(params.weekdays)
  const allowedTimes = configuredTimes(params.pushTimes)
  if (allowedWeekdays.size === 0 || allowedTimes.size === 0) return []

  const nowMs = (params.now ?? new Date()).getTime()
  const catchUpMinutes = readCatchUpMinutes()
  // 下界按分钟取整：在 11:00:30 保存配置，11:00 这个槽仍算生效，早于 11:00 的槽才被挡掉。
  const effectiveSinceMs = params.effectiveSince
    ? Math.floor(params.effectiveSince.getTime() / 60_000) * 60_000
    : null
  const seen = new Set<string>()
  const due: DueScheduledSlot[] = []

  for (let offset = catchUpMinutes; offset >= 0; offset -= 1) {
    const candidate = getRegionNow(params.tz, new Date(nowMs - offset * 60_000))
    if (!allowedWeekdays.has(candidate.weekday)) continue
    if (!allowedTimes.has(candidate.timeHHmm)) continue

    const slotKey = formatScheduledPushSlotKey(candidate)
    if (seen.has(slotKey)) continue
    seen.add(slotKey)

    if (effectiveSinceMs !== null) {
      const slotStartMs = localToUtcMs(`${candidate.dateStr} ${candidate.timeHHmm}:00`, params.tz)
      if (slotStartMs < effectiveSinceMs) {
        console.log(
          `${params.label ?? '[scheduled-push]'} 时间槽 ${slotKey} 早于配置生效时间 ${params.effectiveSince?.toISOString()}，不补发`,
        )
        continue
      }
    }

    due.push(candidate)
  }

  return due
}
