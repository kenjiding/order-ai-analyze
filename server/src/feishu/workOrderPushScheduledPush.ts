import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { WorkOrderPushSchedule, FleetSupplierPushConfig } from '../db/schema'
import { buildWorkOrderPushCard } from './buildWorkOrderPushCard'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { envFirst } from '../imile/shared'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { listPushableConfigsForScope } from '../supplierConfigScopes'
import { supplierDisplayName } from '../supplierPushConfigs'
import { fetchUnprocessedTickets } from '../imile/vendorAnalysis'
import { fetchWorkOrderWaybillVendors } from '../imile/workOrderPushWaybills'
import { aggregateWorkOrderPush } from '../vendorAnalysis/workOrderPushAggregate'
import { claimScheduledSlot } from '../jobs/scheduledClaim'

const WORK_ORDER_PUSH_SCOPE = 'work-order-push.scheduled' as const

type EnabledSchedule = { schedule: WorkOrderPushSchedule; regionCode: string | null }

async function listEnabledSchedules(): Promise<EnabledSchedule[]> {
  const db = getDb()
  return db
    .select({ schedule: schema.workOrderPushSchedules, regionCode: schema.users.regionId })
    .from(schema.workOrderPushSchedules)
    .leftJoin(schema.users, eq(schema.workOrderPushSchedules.userId, schema.users.id))
    .where(eq(schema.workOrderPushSchedules.isEnabled, true))
}

export function readWorkOrderPushImileToken(
  schedule?: Pick<WorkOrderPushSchedule, 'imileToken'> | null,
): string {
  const fromSchedule = schedule?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_WORK_ORDER_PUSH_TOKEN') ?? ''
}

export function hasWorkOrderPushImileToken(
  schedule?: Pick<WorkOrderPushSchedule, 'imileToken'> | null,
): boolean {
  return readWorkOrderPushImileToken(schedule).length > 0
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
  startTime: string
  endTime: string
  pushTime: string
  baseDate: string
  configs: FleetSupplierPushConfig[]
  label: string
}): Promise<WorkOrderPushResult | { error: string }> {
  const { token, startTime, endTime, pushTime, baseDate, configs, label } = params

  const ticketsRes = await fetchUnprocessedTickets(token, { startTime, endTime })
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
    if (!summary || summary.totalCount === 0) continue // 有就推送，没有就不用推送

    const card = buildWorkOrderPushCard({
      vendorName: supplierDisplayName(config),
      baseDate,
      pushTime,
      summary,
      pushDescription: config.pushDescription,
    })
    const ok = await pushCardToWebhook(config.webhookUrl, config.signingSecret, card)
    if (ok) {
      pushedCount++
    } else {
      errors.push(`${supplierDisplayName(config)}: 飞书推送失败`)
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
    const scopedConfigs = await listPushableConfigsForScope(WORK_ORDER_PUSH_SCOPE)
    for (const { schedule, regionCode } of enabled) {
      if (!hasWorkOrderPushImileToken(schedule)) {
        console.warn(`${label} 配置 ${schedule.id} 已启用，但缺少 iMile token`)
        continue
      }
      const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
      console.log(
        `${label} 就绪 user=${schedule.userId} times=[${pushTimes.map((s) => s.time).join(',')}] region=${
          regionCode ?? '(默认阿德莱德)'
        } scopedSuppliers=${scopedConfigs.length}`,
      )
    }
  } catch (err) {
    console.error(`${label} 启动自检失败:`, err)
  }
}

async function runOneScheduledPush(schedule: WorkOrderPushSchedule, regionCode: string | null): Promise<void> {
  const label = `[work-order-push/scheduler user=${schedule.userId}]`

  const tz: AusTz = resolveRegionTz(regionCode)
  const { timeHHmm, dateStr } = getRegionNow(tz)
  // 工单出现时间不可预测，每天都要检查，不做星期筛选
  const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
  if (!pushTimes.some((s) => s.time === timeHHmm)) return

  const claimed = await claimScheduledSlot(`work-order-push:${schedule.id}`, `${dateStr}|${timeHHmm}`)
  if (!claimed) {
    console.log(`${label} 时间槽 date=${dateStr} time=${timeHHmm} 已被推送过（其他 worker 抢先处理），跳过`)
    return
  }

  const token = readWorkOrderPushImileToken(schedule)
  if (!token) {
    console.warn(`${label} 命中推送时间 time=${timeHHmm}，但缺少 iMile token`)
    return
  }

  console.log(`${label} 命中推送时间 time=${timeHHmm} baseDate=${dateStr}`)

  const configs = await listPushableConfigsForScope(WORK_ORDER_PUSH_SCOPE)
  if (configs.length === 0) {
    console.log(`${label} 无参与工单推送的供应商，跳过（请在「工单推送」启用供应商）`)
    return
  }

  const { startTime, endTime } = computeUnprocessedTicketWindow(tz)
  const result = await executeWorkOrderPush({
    token,
    startTime,
    endTime,
    pushTime: timeHHmm,
    baseDate: dateStr,
    configs,
    label,
  })
  if ('error' in result) {
    console.error(`${label} 推送失败: ${result.error}`)
    return
  }
  console.log(`${label} 完成 ${result.pushedCount}/${result.totalConfigs} 条`)
}

/** 每分钟由 scheduler 调用 */
export async function runWorkOrderPushScheduledPush(): Promise<void> {
  const label = '[work-order-push/scheduler]'
  const enabled = await listEnabledSchedules()
  for (const { schedule, regionCode } of enabled) {
    try {
      await runOneScheduledPush(schedule, regionCode)
    } catch (err) {
      console.error(`${label} 配置 ${schedule.id}（user=${schedule.userId}）推送异常:`, err)
    }
  }
}
