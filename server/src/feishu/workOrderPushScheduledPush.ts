import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { WorkOrderPushSchedule, FleetSupplierPushConfig } from '../db/schema'
import { buildWorkOrderPushCard } from './buildWorkOrderPushCard'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { envFirst } from '../imile/shared'
import { getGlobalImileToken } from './globalImileToken'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { listPushableSupplierPushConfigsByIds, parsePushConfigIds, supplierDisplayName } from '../supplierPushConfigs'
import { fetchUnprocessedTickets } from '../imile/vendorAnalysis'
import { fetchWorkOrderWaybillVendors } from '../imile/workOrderPushWaybills'
import { aggregateWorkOrderPush } from '../vendorAnalysis/workOrderPushAggregate'
import {
  claimScheduledSlot,
  countClaimedSlots,
  formatScheduledPushSlotKey,
  releaseScheduledSlot,
} from '../jobs/scheduledClaim'
import { resolveDueScheduledSlots } from '../jobs/scheduledDueSlots'

/** 工单出现时间不可预测，不做星期筛选：传入全 7 天等价于「每天都检查」 */
const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

type EnabledSchedule = { schedule: WorkOrderPushSchedule; regionCode: string | null }

async function listEnabledSchedules(): Promise<EnabledSchedule[]> {
  const db = getDb()
  return db
    .select({ schedule: schema.workOrderPushSchedules, regionCode: schema.users.regionId })
    .from(schema.workOrderPushSchedules)
    .leftJoin(schema.users, eq(schema.workOrderPushSchedules.userId, schema.users.id))
    .where(eq(schema.workOrderPushSchedules.isEnabled, true))
}

export async function readWorkOrderPushImileToken(
  schedule?: Pick<WorkOrderPushSchedule, 'imileToken' | 'userId'> | null,
): Promise<string> {
  if (schedule?.userId) {
    const fromGlobalSettings = await getGlobalImileToken(schedule.userId)
    if (fromGlobalSettings) return fromGlobalSettings
  }
  const fromSchedule = schedule?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_WORK_ORDER_PUSH_TOKEN') ?? ''
}

export async function hasWorkOrderPushImileToken(
  schedule?: Pick<WorkOrderPushSchedule, 'imileToken' | 'userId'> | null,
): Promise<boolean> {
  return (await readWorkOrderPushImileToken(schedule)).length > 0
}

/** 按日期字符串做纯日历减法（不依赖时区毫秒换算，与前端 dayjs .subtract('day') 口径一致） */
function subtractDaysFromDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

/**
 * 未处理工单查询窗口：与「供应商数据分析」的 unprocessedStartTime/yesterdayEndTime 公式一致——
 * 参考日期（今天）所在自然周的上周一 00:00:00 ~ 昨天 23:59:59。
 * 对应前端 src/pages/VendorAnalysis/useVendorAnalysisPage.ts 的 buildEnqueueParams。
 */
export function computeUnprocessedTicketWindow(tz: AusTz): { startTime: string; endTime: string } {
  const { weekday, dateStr, prevDateStr } = getRegionNow(tz)
  // weekday: 1=周一…7=周日；上周一 = 本周一（today - (weekday-1)）再往前 7 天
  const lastMondayDateStr = subtractDaysFromDateStr(dateStr, weekday - 1 + 7)
  return { startTime: `${lastMondayDateStr} 00:00:00`, endTime: `${prevDateStr} 23:59:59` }
}

async function pushCardToWebhook(
  webhookUrl: string,
  signingSecret: string | null,
  card: Record<string, unknown>,
): Promise<boolean> {
  let webhookHref: string
  try {
    webhookHref = parseSafeWebhookUrl(webhookUrl).href
  } catch {
    return false
  }
  const payload: Record<string, unknown> = { msg_type: 'interactive', card }
  if (signingSecret) {
    const timestampSec = Math.floor(Date.now() / 1000)
    payload.timestamp = String(timestampSec)
    payload.sign = computeFeishuWebhookSign(signingSecret, timestampSec)
  }
  try {
    const upstream = await fetch(webhookHref, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>
    return upstream.ok && typeof data.code === 'number' && data.code === 0
  } catch {
    return false
  }
}

export type WorkOrderPushResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
}

/**
 * 工单推送核心：拉未处理工单 → 按 waybillNo 解析供应商归属 → 聚合 → 按供应商逐个推送（无工单则跳过该供应商）。
 * 供定时任务与「立即推送」复用。
 */
export async function executeWorkOrderPush(params: {
  token: string
  stationCode: string
  startTime: string
  endTime: string
  pushTime: string
  baseDate: string
  tz: AusTz
  configs: FleetSupplierPushConfig[]
  label: string
  /**
   * 仅供定时任务传入：按 (jobKeyPrefix:configId, slotKey) 对每个供应商配置单独做幂等去重。
   * 「立刻推送」不传此参数，始终对全部 configs 重新执行。
   */
  perConfigDedupe?: { jobKeyPrefix: string; slotKey: string }
}): Promise<WorkOrderPushResult | { error: string }> {
  const { token, stationCode, startTime, endTime, pushTime, baseDate, tz, configs, label, perConfigDedupe } = params

  const ticketsRes = await fetchUnprocessedTickets(token, { startTime, endTime, stationCode })
  if (!ticketsRes.ok) {
    console.error(`${label} 未处理工单查询失败: ${ticketsRes.message}`)
    return { error: `未处理工单查询失败: ${ticketsRes.message}` }
  }
  const { normalTickets, complaintTickets, arbitrationTickets } = ticketsRes.data

  const allWaybillNos = [...normalTickets, ...complaintTickets, ...arbitrationTickets]
    .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>).waybillNo : undefined))
    .filter((no): no is string => typeof no === 'string' && no.trim().length > 0)

  const vendorRes = await fetchWorkOrderWaybillVendors(token, allWaybillNos)
  if (!vendorRes.ok) {
    console.error(`${label} 运单供应商查询失败: ${vendorRes.message}`)
    return { error: `运单供应商查询失败: ${vendorRes.message}` }
  }

  const { byVendor, unmatchedCount } = aggregateWorkOrderPush({
    normalTickets,
    complaintTickets,
    arbitrationTickets,
    waybillVendorMap: vendorRes.data,
  })
  if (unmatchedCount > 0) {
    console.warn(`${label} 有 ${unmatchedCount} 条工单未能解析出供应商归属（waybillNo 缺失或运单查询未命中），已跳过`)
  }

  let pushedCount = 0
  const errors: string[] = []

  for (const config of configs) {
    const summary = byVendor.get(config.vendorCode)
    if (!summary || summary.totalCount === 0) continue // 有就推送，没有就不用推送；不 claim，留给下次重新判断

    const vendorName = supplierDisplayName(config)

    let dedupeJobKey: string | null = null
    if (perConfigDedupe) {
      dedupeJobKey = `${perConfigDedupe.jobKeyPrefix}:${config.id}`
      const claimed = await claimScheduledSlot(dedupeJobKey, perConfigDedupe.slotKey)
      if (!claimed) {
        console.log(`${label} ${vendorName} 本时间槽已推送成功过，跳过`)
        continue
      }
    }

    try {
      const card = buildWorkOrderPushCard({
        vendorName,
        baseDate,
        pushTime,
        tz,
        summary,
        pushDescription: config.pushDescription,
      })
      const ok = await pushCardToWebhook(config.webhookUrl, config.signingSecret, card)
      if (ok) {
        pushedCount++
      } else {
        errors.push(`${vendorName}: 飞书推送失败`)
        if (dedupeJobKey) await releaseScheduledSlot(dedupeJobKey, perConfigDedupe!.slotKey)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${label} ✗ 处理异常: ${vendorName} (${msg})`)
      errors.push(`${vendorName}: 处理异常(${msg})`)
      if (dedupeJobKey) await releaseScheduledSlot(dedupeJobKey, perConfigDedupe!.slotKey)
    }
  }

  return { pushedCount, totalConfigs: configs.length, errors }
}

/** worker 启动自检 */
export async function logWorkOrderPushSchedulerReadiness(): Promise<void> {
  const label = '[work-order-push/scheduler]'
  try {
    const enabled = await listEnabledSchedules()
    if (enabled.length === 0) {
      console.log(`${label} 尚无已启用的定时配置，等待各账号页面保存后生效`)
      return
    }
    for (const { schedule, regionCode } of enabled) {
      if (!schedule.stationCode?.trim()) {
        console.warn(`${label} 配置 ${schedule.id} 已启用，但未保存站点编码 stationCode`)
      }
      if (!(await hasWorkOrderPushImileToken(schedule))) {
        console.warn(`${label} 配置 ${schedule.id} 已启用，但缺少 iMile token`)
        continue
      }
      const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
      const scopedCount = parsePushConfigIds(schedule.pushConfigIds).length
      console.log(
        `${label} 就绪 user=${schedule.userId} times=[${pushTimes.map((s) => s.time).join(',')}] station=${
          schedule.stationCode
        } region=${regionCode ?? '(默认阿德莱德)'} scopedSuppliers=${scopedCount}`,
      )
    }
  } catch (err) {
    console.error(`${label} 启动自检失败:`, err)
  }
}

async function runOneScheduledPush(schedule: WorkOrderPushSchedule, regionCode: string | null): Promise<void> {
  const label = `[work-order-push/scheduler user=${schedule.userId}]`

  const stationCode = schedule.stationCode?.trim()
  if (!stationCode) return

  const tz: AusTz = resolveRegionTz(regionCode)
  const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
  // 工单出现时间不可预测，不做星期筛选：ALL_WEEKDAYS 等价于「每天都检查」，同时获得 catch-up 补跑窗口
  const dueSlots = resolveDueScheduledSlots({ tz, weekdays: ALL_WEEKDAYS, pushTimes })
  if (dueSlots.length === 0) return

  for (const slot of dueSlots) {
    const { timeHHmm, dateStr } = slot
    const jobKeyPrefix = `work-order-push:${schedule.id}`
    const slotKey = formatScheduledPushSlotKey(slot)

    const token = await readWorkOrderPushImileToken(schedule)
    if (!token) {
      console.warn(`${label} 命中推送时间 time=${timeHHmm}，但缺少 iMile token`)
      continue
    }

    const configs = await listPushableSupplierPushConfigsByIds(parsePushConfigIds(schedule.pushConfigIds))
    if (configs.length === 0) {
      console.log(`${label} 无参与工单推送的供应商，跳过（请在该条目的「供应商配置」启用供应商）`)
      continue
    }

    // 幂等粒度下沉到「每个供应商配置」：先快速判断本时间槽是否已全部推送成功，
    // 全部完成则跳过，避免 catch-up 重试窗口内每分钟都重新拉一遍工单数据。
    const configJobKeys = configs.map((c) => `${jobKeyPrefix}:${c.id}`)
    const claimedCount = await countClaimedSlots(configJobKeys, slotKey)
    if (claimedCount >= configs.length) {
      console.log(`${label} 时间槽 date=${dateStr} time=${timeHHmm} 已全部推送成功，跳过`)
      continue
    }

    console.log(`${label} 命中推送时间 time=${timeHHmm} baseDate=${dateStr}`)

    const { startTime, endTime } = computeUnprocessedTicketWindow(tz)
    const result = await executeWorkOrderPush({
      token,
      stationCode,
      startTime,
      endTime,
      pushTime: timeHHmm,
      baseDate: dateStr,
      tz,
      configs,
      label,
      perConfigDedupe: { jobKeyPrefix, slotKey },
    })
    if ('error' in result) {
      console.error(`${label} 推送失败: ${result.error}`)
      continue
    }
    console.log(`${label} 完成 ${result.pushedCount}/${result.totalConfigs} 条`)
  }
}

let isRunning = false

/** 每分钟由 scheduler 调用 */
export async function runWorkOrderPushScheduledPush(): Promise<void> {
  const label = '[work-order-push/scheduler]'
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
