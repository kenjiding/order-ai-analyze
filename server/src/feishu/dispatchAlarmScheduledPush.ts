import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { DispatchAlarmSchedule, FleetSupplierPushConfig } from '../db/schema'
import { buildDispatchAlarmCard } from './buildDispatchAlarmCard'
import { createDispatchAlarmShareSnapshot } from './dispatchAlarmShareSnapshot'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { envFirst } from '../imile/shared'
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { fetchDriverWaybills } from '../imile/driverPerformance'
import {
  listPushableSupplierPushConfigsForSchedule,
  parsePushConfigIds,
  parseRouteCodes,
  parseRouteCodeWhitelistSet,
  supplierDisplayName,
} from '../supplierPushConfigs'
import { aggregateDispatch24hByVendor, type Dispatch24hWaybillRow } from '../vendorAnalysis/dispatch24hAggregate'
import { lastSortingWorkdayOnOrBefore } from '../imile/sortingWorkday'
import { claimScheduledSlot, formatScheduledPushSlotKey, releaseScheduledSlot } from '../jobs/scheduledClaim'
import { resolveDueScheduledSlots } from '../jobs/scheduledDueSlots'

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
 * 24H 派签告警核心：拉前一日司机运单 → 按「本配置」vendorCode + routeCode 纳入 + 白名单剔除后聚合
 * （复用 vendorAnalysis/dispatch24hAggregate）→ 逐配置推送（无数据则跳过）。
 * 同一 vendorCode、不同 routeCode 的多条配置各自独立统计，互不混算。
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
  /** 与 tz 同源的账号 regionCode；透传给 fetchDriverWaybills，避免其内部缓存终态判定兜底成阿德莱德、与本次聚合口径的 tz 不一致 */
  regionCode: string | null
  label: string
}): Promise<DispatchAlarmPushResult | { error: string }> {
  const { token, stationCode, date, pushTime, alertThresholdPct, configs, tz, regionCode, label } = params

  const result = await fetchDriverWaybills(token, { stationCode, dateStr: date, regionCode })
  if (!result.ok) {
    console.error(`${label} 运单查询失败: ${result.message}`)
    return { error: `运单查询失败: ${result.message}` }
  }

  const rows = result.data as Dispatch24hWaybillRow[]
  let pushedCount = 0
  const errors: string[] = []

  for (const config of configs) {
    const vendorCode = config.vendorCode.trim()
    if (!vendorCode) continue

    // 按配置独立过滤：避免同供应商多区域（不同 routeCode）共用一份聚合结果
    const statsByVendor = aggregateDispatch24hByVendor({
      rows,
      stationCodes: [stationCode],
      tz,
      routeCodesByVendor: new Map([[vendorCode, new Set(parseRouteCodes(config.routeCode))]]),
      routeCodeWhitelistByVendor: new Map([
        [vendorCode, parseRouteCodeWhitelistSet(config.routeCodeWhitelist)],
      ]),
    })
    const stat = statsByVendor.get(vendorCode)
    if (!stat || stat.total === 0) continue // 无数据不推送

    const vendorName = supplierDisplayName(config)
    const share =
      stat.total - stat.met > 0 || stat.problemCount > 0
        ? await createDispatchAlarmShareSnapshot({
            vendorCode: config.vendorCode,
            vendorName,
            stationCode,
            date,
            pushTime,
            total: stat.total,
            met: stat.met,
            problemCount: stat.problemCount,
            alertThresholdPct,
            drivers: stat.drivers,
          })
        : null

    const card = buildDispatchAlarmCard({
      vendorName,
      stationCode,
      date,
      pushTime,
      total: stat.total,
      met: stat.met,
      problemCount: stat.problemCount,
      drivers: stat.drivers,
      alertThresholdPct,
      pushDescription: config.pushDescription,
      detailUrl: share?.url ?? null,
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
      const scopedCount = parsePushConfigIds(schedule.pushConfigIds).length
      console.log(
        `${label} 就绪 user=${schedule.userId} weekdays=[${weekdays.join(',')}] times=[${pushTimes.map((s) => s.time).join(',')}] station=${schedule.stationCode} threshold=${schedule.alertThresholdPct}% region=${regionCode ?? '(默认阿德莱德)'} scheduledSuppliers=${scopedCount}`,
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
  const weekdays = schedule.weekdays as number[]
  const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
  const dueSlots = resolveDueScheduledSlots({ tz, weekdays, pushTimes })
  if (dueSlots.length === 0) return

  for (const slot of dueSlots) {
    const { weekday, timeHHmm, prevDateStr } = slot
    const jobKey = `dispatch-alarm:${schedule.id}`
    const slotKey = formatScheduledPushSlotKey(slot)

    const token = readDispatchAlarmImileToken(schedule)
    if (!token) {
      console.warn(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm}，但缺少 iMile token，无法拉数推送`)
      continue
    }

    const configs = await listPushableSupplierPushConfigsForSchedule(parsePushConfigIds(schedule.pushConfigIds), {
      regionCode,
      stationCode,
    })
    if (configs.length === 0) {
      console.log(`${label} 无参与定时推送的供应商，跳过（请在该条目的「供应商配置」启用供应商）`)
      continue
    }

    const claimed = await claimScheduledSlot(jobKey, slotKey)
    if (!claimed) {
      console.log(`${label} 时间槽 date=${slot.dateStr} time=${timeHHmm} 已被推送过（其他 worker 抢先处理），跳过`)
      continue
    }

    // 目标日避开周末（周六/日不分拣、无数据）：从前一日往前取第一个工作日
    const targetDate = lastSortingWorkdayOnOrBefore(prevDateStr)
    console.log(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm} date=${targetDate}`)

    const result = await executeDispatchAlarmPush({
      token,
      stationCode,
      date: targetDate,
      pushTime: timeHHmm,
      alertThresholdPct: schedule.alertThresholdPct,
      configs,
      tz,
      regionCode,
      label,
    })
    if ('error' in result) {
      await releaseScheduledSlot(jobKey, slotKey)
      console.error(`${label} 推送失败: ${result.error}`)
      continue
    }
    if (result.pushedCount === 0 && result.errors.length > 0) {
      await releaseScheduledSlot(jobKey, slotKey)
      console.error(`${label} 全部推送失败: ${result.errors.join('; ')}`)
      continue
    }
    console.log(`${label} 完成 ${result.pushedCount}/${result.totalConfigs} 条`)
  }
}

let isRunning = false

/** 每分钟由 scheduler 调用；遍历所有已启用的账号级定时配置，各自独立判断是否命中推送 */
export async function runDispatchAlarmScheduledPush(): Promise<void> {
  const label = '[dispatch-alarm/scheduler]'
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
