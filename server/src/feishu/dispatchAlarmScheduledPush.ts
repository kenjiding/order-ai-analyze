import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { DispatchAlarmSchedule, FleetSupplierPushConfig } from '../db/schema'
import { buildDispatchAlarmCard } from './buildDispatchAlarmCard'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { envFirst } from '../imile/shared'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { fetchDriverWaybills } from '../imile/driverPerformance'
import { listPushableConfigsForScope } from '../supplierConfigScopes'
import { parseRouteCodeWhitelistSet, supplierDisplayName } from '../supplierPushConfigs'
import { aggregateDispatch24hByVendor, type Dispatch24hWaybillRow } from '../vendorAnalysis/dispatch24hAggregate'
import { lastSortingWorkdayOnOrBefore } from '../imile/sortingWorkday'
import { claimScheduledSlot } from '../jobs/scheduledClaim'

const DISPATCH_ALARM_SCOPE = 'dispatch-alarm.scheduled' as const

type EnabledSchedule = { schedule: DispatchAlarmSchedule; regionCode: string | null }

/** 已启用的定时配置（按账号隔离），附带各自拥有者的 regionCode */
async function listEnabledSchedules(): Promise<EnabledSchedule[]> {
  const db = getDb()
  return db
    .select({ schedule: schema.dispatchAlarmSchedules, regionCode: schema.users.regionId })
    .from(schema.dispatchAlarmSchedules)
    .leftJoin(schema.users, eq(schema.dispatchAlarmSchedules.userId, schema.users.id))
    .where(eq(schema.dispatchAlarmSchedules.isEnabled, true))
}

export function readDispatchAlarmImileToken(schedule?: Pick<DispatchAlarmSchedule, 'imileToken'> | null): string {
  const fromSchedule = schedule?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_DISPATCH_ALARM_TOKEN') ?? ''
}

export function hasDispatchAlarmImileToken(schedule?: Pick<DispatchAlarmSchedule, 'imileToken'> | null): boolean {
  return readDispatchAlarmImileToken(schedule).length > 0
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

export type DispatchAlarmPushResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
  stationCode: string
  date: string
}

/**
 * 24H 派签告警核心：拉前一日司机运单 → 按供应商聚合达标情况（复用 vendorAnalysis/dispatch24hAggregate）
 * → 按供应商逐个推送（无数据则跳过该供应商）。供定时任务与「立即推送」复用。
 */
export async function executeDispatchAlarmPush(params: {
  token: string
  stationCode: string
  /** 前一日日期 YYYY-MM-DD */
  date: string
  pushTime: string
  alertThresholdPct: number
  configs: FleetSupplierPushConfig[]
  tz: AusTz
  label: string
}): Promise<DispatchAlarmPushResult | { error: string }> {
  const { token, stationCode, date, pushTime, alertThresholdPct, configs, tz, label } = params

  const result = await fetchDriverWaybills(token, { stationCode, dateStr: date })
  if (!result.ok) {
    console.error(`${label} 运单查询失败: ${result.message}`)
    return { error: `运单查询失败: ${result.message}` }
  }

  const routeCodeWhitelistByVendor = new Map<string, Set<string>>()
  for (const config of configs) {
    routeCodeWhitelistByVendor.set(config.vendorCode, parseRouteCodeWhitelistSet(config.routeCodeWhitelist))
  }

  const statsByVendor = aggregateDispatch24hByVendor({
    rows: result.data as Dispatch24hWaybillRow[],
    stationCodes: [stationCode],
    tz,
    routeCodeWhitelistByVendor,
  })

  let pushedCount = 0
  const errors: string[] = []

  for (const config of configs) {
    const stat = statsByVendor.get(config.vendorCode)
    if (!stat || stat.total === 0) continue // 无数据不推送

    const card = buildDispatchAlarmCard({
      vendorName: supplierDisplayName(config),
      stationCode,
      date,
      pushTime,
      total: stat.total,
      met: stat.met,
      drivers: stat.drivers,
      alertThresholdPct,
      pushDescription: config.pushDescription,
    })
    const ok = await pushCardToWebhook(config.webhookUrl, config.signingSecret, card)
    if (ok) {
      pushedCount++
    } else {
      errors.push(`${supplierDisplayName(config)}: 飞书推送失败`)
    }
  }

  return { pushedCount, totalConfigs: configs.length, errors, stationCode, date }
}

/** worker 启动时检查定时推送前置条件，便于排查「配置了但不执行」 */
export async function logDispatchAlarmSchedulerReadiness(): Promise<void> {
  const label = '[dispatch-alarm/scheduler]'
  try {
    const enabled = await listEnabledSchedules()
    if (enabled.length === 0) {
      console.log(`${label} 尚无已启用的定时配置，等待各账号页面保存后生效`)
      return
    }
    const scopedConfigs = await listPushableConfigsForScope(DISPATCH_ALARM_SCOPE)
    for (const { schedule, regionCode } of enabled) {
      if (!schedule.stationCode?.trim()) {
        console.warn(`${label} 配置 ${schedule.id} 已启用，但未保存站点编码 stationCode`)
      }
      if (!hasDispatchAlarmImileToken(schedule)) {
        console.warn(`${label} 配置 ${schedule.id} 已启用，但缺少 iMile token`)
        continue
      }
      const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
      const weekdays = schedule.weekdays as number[]
      console.log(
        `${label} 就绪 user=${schedule.userId} weekdays=[${weekdays.join(',')}] times=[${pushTimes.map((s) => s.time).join(',')}] station=${schedule.stationCode} threshold=${schedule.alertThresholdPct}% region=${regionCode ?? '(默认阿德莱德)'} scheduledSuppliers=${scopedConfigs.length}`,
      )
    }
  } catch (err) {
    console.error(`${label} 启动自检失败:`, err)
  }
}

async function runOneScheduledPush(schedule: DispatchAlarmSchedule, regionCode: string | null): Promise<void> {
  const label = `[dispatch-alarm/scheduler user=${schedule.userId}]`

  const stationCode = schedule.stationCode?.trim()
  if (!stationCode) return

  const tz = resolveRegionTz(regionCode)
  const { weekday, timeHHmm, prevDateStr } = getRegionNow(tz)
  const weekdays = schedule.weekdays as number[]
  if (!weekdays.includes(weekday)) return

  const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
  const matchedSlot = pushTimes.find((s) => s.time === timeHHmm)
  if (!matchedSlot) return

  const claimed = await claimScheduledSlot(`dispatch-alarm:${schedule.id}`, `${prevDateStr}|${timeHHmm}`)
  if (!claimed) {
    console.log(`${label} 时间槽 date=${prevDateStr} time=${timeHHmm} 已被推送过（其他 worker 抢先处理），跳过`)
    return
  }

  const token = readDispatchAlarmImileToken(schedule)
  if (!token) {
    console.warn(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm}，但缺少 iMile token，无法拉数推送`)
    return
  }

  // 目标日避开周末（周六/日不分拣、无数据）：从前一日往前取第一个工作日
  const targetDate = lastSortingWorkdayOnOrBefore(prevDateStr)
  console.log(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm} date=${targetDate}`)

  const configs = await listPushableConfigsForScope(DISPATCH_ALARM_SCOPE)
  if (configs.length === 0) {
    console.log(`${label} 无参与定时推送的供应商，跳过（请在「24小时派签告警」启用供应商）`)
    return
  }

  const result = await executeDispatchAlarmPush({
    token,
    stationCode,
    date: targetDate,
    pushTime: timeHHmm,
    alertThresholdPct: schedule.alertThresholdPct,
    configs,
    tz,
    label,
  })
  if ('error' in result) {
    console.error(`${label} 推送失败: ${result.error}`)
    return
  }
  console.log(`${label} 完成 ${result.pushedCount}/${result.totalConfigs} 条`)
}

/** 每分钟由 scheduler 调用；遍历所有已启用的账号级定时配置，各自独立判断是否命中推送 */
export async function runDispatchAlarmScheduledPush(): Promise<void> {
  const label = '[dispatch-alarm/scheduler]'
  const enabled = await listEnabledSchedules()
  for (const { schedule, regionCode } of enabled) {
    try {
      await runOneScheduledPush(schedule, regionCode)
    } catch (err) {
      console.error(`${label} 配置 ${schedule.id}（user=${schedule.userId}）推送异常:`, err)
    }
  }
}
