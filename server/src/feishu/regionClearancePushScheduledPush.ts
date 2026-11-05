import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { RegionClearancePushSchedule } from '../db/schema'
import {
  fetchDeliveredByRegion,
  fetchOfdReportByRegion,
  fetchOutboundStockInventory,
  fetchPendingDeliveryInventory,
} from '../imile/regionClearancePush'
import { resolveRegionTz } from '../imile/ausTimezone'
import { envFirst } from '../imile/shared'
import { getGlobalImileToken } from './globalImileToken'
import { parseSupplierMentionContacts } from './feishuMentionHelpers'
import { sendFeishuChatImageMessage } from './sendFeishuOpenApiMessage'
import { aggregateDispatchDelivered, aggregateInventory } from '../regionClearancePush/aggregate'
import { buildRegionClearancePushHtml } from '../regionClearancePush/buildRegionClearancePushHtml'
import { renderHtmlToPngDataUrl } from '../regionClearancePush/renderHtmlToImage'
import { parseRegionClearanceSnapshot, parseStationEntries } from '../regionClearancePush/types'
import { claimScheduledSlot, formatScheduledPushSlotKey, releaseScheduledSlot } from '../jobs/scheduledClaim'
import { resolveDueScheduledSlots } from '../jobs/scheduledDueSlots'

type EnabledSchedule = { schedule: RegionClearancePushSchedule; regionCode: string | null }

async function listEnabledSchedules(): Promise<EnabledSchedule[]> {
  const db = getDb()
  const rows = await db
    .select({ schedule: schema.regionClearancePushSchedules, regionCode: schema.users.regionId })
    .from(schema.regionClearancePushSchedules)
    .leftJoin(schema.users, eq(schema.regionClearancePushSchedules.userId, schema.users.id))
    .where(eq(schema.regionClearancePushSchedules.isEnabled, true))
  return rows
}

export async function readRegionClearancePushImileToken(
  schedule?: Pick<RegionClearancePushSchedule, 'imileToken' | 'userId'> | null,
): Promise<string> {
  if (schedule?.userId) {
    const fromGlobalSettings = await getGlobalImileToken(schedule.userId)
    if (fromGlobalSettings) return fromGlobalSettings
  }
  const fromSchedule = schedule?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_REGION_CLEARANCE_PUSH_TOKEN') ?? ''
}

export async function logRegionClearancePushSchedulerReadiness(): Promise<void> {
  const label = '[region-clearance-push/scheduler]'
  try {
    const enabled = await listEnabledSchedules()
    if (enabled.length === 0) {
      console.log(`${label} 尚无已启用的定时配置，等待各账号页面保存后生效`)
      return
    }
    for (const { schedule } of enabled) {
      if (!(await readRegionClearancePushImileToken(schedule))) {
        console.warn(`${label} 配置 ${schedule.id} 已启用，但缺少 iMile token（保存配置时需携带全局 token）`)
        continue
      }
      if (!schedule.chatId?.trim()) {
        console.warn(`${label} 配置 ${schedule.id} 已启用，但未配置推送群 chatId`)
      }
    }
  } catch (err) {
    console.error(`${label} 启动自检失败:`, err)
  }
}

/**
 * 单次执行：拉昨日+今日的派件/签收数据、今日库存，聚合后建卡推送。
 * 供定时任务与「立即推送」路由共用，不校验 weekdays/pushTimes。
 */
export async function executeRegionClearancePush(params: {
  token: string
  schedule: Pick<
    RegionClearancePushSchedule,
    'id' | 'regionCode' | 'regionName' | 'stationCodes' | 'chatId' | 'mentionOpenIds' | 'lastSnapshot'
  >
  todayDateStr: string
  yesterdayDateStr: string
  pushTime: string
  label: string
  /** 只有真正的定时任务传 true；「立即推送」传 false，只读快照做对比展示，不覆盖趋势基准 */
  updateSnapshot: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { token, schedule, todayDateStr, yesterdayDateStr, pushTime, label, updateSnapshot } = params
  const regionCode = schedule.regionCode
  const stations = parseStationEntries(schedule.stationCodes)
  const stationCodes = stations.map((s) => s.code)

  const [todayOfd, todayDelivered, yesterdayOfd, yesterdayDelivered, pending, outbound] = await Promise.all([
    fetchOfdReportByRegion({ token, regionCode, startTime: `${todayDateStr} 00:00:00`, endTime: `${todayDateStr} 23:59:59` }),
    fetchDeliveredByRegion({ token, regionCode, startTime: `${todayDateStr} 00:00:00`, endTime: `${todayDateStr} 23:59:59` }),
    fetchOfdReportByRegion({
      token,
      regionCode,
      startTime: `${yesterdayDateStr} 00:00:00`,
      endTime: `${yesterdayDateStr} 23:59:59`,
    }),
    fetchDeliveredByRegion({
      token,
      regionCode,
      startTime: `${yesterdayDateStr} 00:00:00`,
      endTime: `${yesterdayDateStr} 23:59:59`,
    }),
    fetchPendingDeliveryInventory({ token, regionCode }),
    fetchOutboundStockInventory({ token, regionCode }),
  ])

  for (const [name, res] of [
    ['今日派件统计', todayOfd],
    ['今日签收统计', todayDelivered],
    ['昨日派件统计', yesterdayOfd],
    ['昨日签收统计', yesterdayDelivered],
    ['仓内库存', pending],
    ['仓外库存', outbound],
  ] as const) {
    if (!res.ok) return { ok: false, error: `${name}查询失败: ${res.message}` }
  }
  if (!todayOfd.ok || !todayDelivered.ok || !yesterdayOfd.ok || !yesterdayDelivered.ok || !pending.ok || !outbound.ok) {
    return { ok: false, error: '数据查询失败' }
  }

  const todayStat = aggregateDispatchDelivered({ ofdRows: todayOfd.data, deliveredRows: todayDelivered.data, stationCodes })
  const yesterdayStat = aggregateDispatchDelivered({
    ofdRows: yesterdayOfd.data,
    deliveredRows: yesterdayDelivered.data,
    stationCodes,
  })
  const inventoryStat = aggregateInventory({
    pendingRows: pending.data,
    outboundRows: outbound.data,
    stationCodes,
    todayDateStr,
  })

  const mentions = parseSupplierMentionContacts(schedule.mentionOpenIds)
  const previousSnapshot = parseRegionClearanceSnapshot(schedule.lastSnapshot)
  const html = buildRegionClearancePushHtml({
    regionName: schedule.regionName,
    stations,
    pushTimeLabel: `${todayDateStr} ${pushTime}`,
    yesterdayDateStr,
    todayDateStr,
    yesterdayStat,
    todayStat,
    inventoryStat,
    previousSnapshot,
  })

  const rendered = await renderHtmlToPngDataUrl(html)
  if (!rendered.ok) {
    console.error(`${label} ✗ 截图渲染失败: ${rendered.error}`)
    return { ok: false, error: `截图渲染失败: ${rendered.error}` }
  }

  const sendRes = await sendFeishuChatImageMessage({
    chatId: schedule.chatId,
    imageBase64: rendered.dataUrl,
    leadingText: `${schedule.regionName} 大盘数据如下图所示`,
    mentions,
  })
  if (!sendRes.ok) {
    console.error(`${label} ✗ 推送失败: ${sendRes.error}`)
    return { ok: false, error: sendRes.error }
  }
  console.log(`${label} ✓ 推送成功: ${schedule.regionName}`)

  if (updateSnapshot) {
    await getDb()
      .update(schema.regionClearancePushSchedules)
      .set({ lastSnapshot: { todayStat, inventoryStat }, lastSnapshotAt: new Date() })
      .where(eq(schema.regionClearancePushSchedules.id, schedule.id))
  }

  return { ok: true }
}

async function runOneScheduledPush(schedule: RegionClearancePushSchedule, regionCode: string | null): Promise<void> {
  const label = `[region-clearance-push/scheduler user=${schedule.userId}]`
  if (!schedule.regionCode?.trim() || !schedule.chatId?.trim()) return

  const tz = resolveRegionTz(regionCode)
  const weekdays = schedule.weekdays as number[]
  const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
  const dueSlots = resolveDueScheduledSlots({
    tz,
    weekdays,
    pushTimes,
    effectiveSince: schedule.updatedAt,
    label,
  })
  if (dueSlots.length === 0) return

  for (const slot of dueSlots) {
    const { timeHHmm, dateStr: todayDateStr, prevDateStr: yesterdayDateStr } = slot
    const jobKey = `region-clearance-push:${schedule.id}`
    const slotKey = formatScheduledPushSlotKey(slot)

    const rawToken = await readRegionClearancePushImileToken(schedule)
    if (!rawToken) {
      console.warn(`${label} 命中推送时间 time=${timeHHmm}，但缺少 iMile token，无法拉数推送`)
      continue
    }

    const claimed = await claimScheduledSlot(jobKey, slotKey)
    if (!claimed) {
      console.log(`${label} 时间槽 ${slotKey} 已推送成功过，跳过`)
      continue
    }

    console.log(`${label} 命中推送时间 time=${timeHHmm} 大区=${schedule.regionName}`)
    const result = await executeRegionClearancePush({
      token: rawToken,
      schedule,
      todayDateStr,
      yesterdayDateStr,
      pushTime: timeHHmm,
      label,
      updateSnapshot: true,
    })
    if (!result.ok) {
      console.error(`${label} 推送失败: ${result.error}`)
      await releaseScheduledSlot(jobKey, slotKey)
    }
  }
}

let isRunning = false

/** 每分钟由 scheduler 调用；遍历所有已启用的账号级定时配置，各自独立判断是否命中推送 */
export async function runRegionClearancePushScheduledPush(): Promise<void> {
  const label = '[region-clearance-push/scheduler]'
  if (isRunning) {
    console.warn(`${label} 上一次执行仍在进行中，跳过本次触发`)
    return
  }
  isRunning = true
  try {
    const enabled = await listEnabledSchedules()
    for (const { schedule, regionCode } of enabled) {
      try {
        await runOneScheduledPush(schedule, regionCode)
      } catch (err) {
        console.error(`${label} 配置 ${schedule.id}（user=${schedule.userId}）推送异常:`, err)
      }
    }
  } finally {
    isRunning = false
  }
}
