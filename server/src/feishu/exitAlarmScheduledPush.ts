import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { ExitAlarmSchedule, FleetSupplierPushConfig } from '../db/schema'
import { buildExitAlarmCard } from './buildExitAlarmCard'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { envFirst } from '../imile/shared'
import { fetchWaybillDetailsByInboundIndex } from '../imile/inboundWaybillIndex'
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { buildExitAlarmZoneBreakdown, computeBefore11ThresholdMs } from '../imile/before11Exit'
import { lastSortingWorkdayOnOrBefore } from '../imile/sortingWorkday'
import {
  listPushableSupplierPushConfigsForSchedule,
  parsePushConfigIds,
  parseRouteCodes,
  parseRouteCodeWhitelistSet,
  supplierDisplayName,
} from '../supplierPushConfigs'
import { claimScheduledSlot, formatScheduledPushSlotKey, releaseScheduledSlot } from '../jobs/scheduledClaim'
import { resolveDueScheduledSlots } from '../jobs/scheduledDueSlots'

type EnabledSchedule = { schedule: ExitAlarmSchedule; regionCode: string | null }

/** 已启用的定时配置（按账号隔离），附带各自拥有者的 regionCode */
async function listEnabledSchedules(): Promise<EnabledSchedule[]> {
  const db = getDb()
  const rows = await db
    .select({ schedule: schema.exitAlarmSchedules, regionCode: schema.users.regionId })
    .from(schema.exitAlarmSchedules)
    .leftJoin(schema.users, eq(schema.exitAlarmSchedules.userId, schema.users.id))
    .where(eq(schema.exitAlarmSchedules.isEnabled, true))
  return rows
}

export function readExitAlarmImileToken(schedule?: Pick<ExitAlarmSchedule, 'imileToken'> | null): string {
  const fromSchedule = schedule?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_EXIT_ALARM_TOKEN') ?? ''
}

export function hasExitAlarmImileToken(schedule?: Pick<ExitAlarmSchedule, 'imileToken'> | null): boolean {
  return readExitAlarmImileToken(schedule).length > 0
}

/** worker 启动时检查定时推送前置条件，便于排查「配置了但不执行」 */
export async function logExitAlarmSchedulerReadiness(): Promise<void> {
  const label = '[exit-alarm/scheduler]'
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
      if (!hasExitAlarmImileToken(schedule)) {
        console.warn(
          `${label} 配置 ${schedule.id} 已启用，但缺少 iMile token（保存配置时需携带全局 token，或设置 IMILE_EXIT_ALARM_TOKEN）`,
        )
        continue
      }
      const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
      const weekdays = schedule.weekdays as number[]
      const scheduledCount = parsePushConfigIds(schedule.pushConfigIds).length
      console.log(
        `${label} 就绪 user=${schedule.userId} weekdays=[${weekdays.join(',')}] times=[${pushTimes.map((s) => s.time).join(',')}] station=${schedule.stationCode} region=${regionCode ?? '(默认阿德莱德)'} scheduledSuppliers=${scheduledCount}`,
      )
    }
  } catch (err) {
    console.error(`${label} 启动自检失败:`, err)
  }
}

async function pushCardToWebhook(
  webhookUrl: string,
  signingSecret: string | null,
  card: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string }> {
  let webhookHref: string
  try {
    webhookHref = parseSafeWebhookUrl(webhookUrl).href
  } catch {
    return { ok: false, reason: 'webhookUrl 不合法' }
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
    if (upstream.ok && typeof data.code === 'number' && data.code === 0) {
      return { ok: true }
    }
    return { ok: false, reason: `飞书返回 code=${String(data.code)}` }
  } catch (err) {
    const cause = err instanceof Error ? (err.cause as { code?: string } | undefined)?.code : undefined
    return { ok: false, reason: `网络错误(${cause ?? (err instanceof Error ? err.message : String(err))})` }
  }
}

export type ExitAlarmPushResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
  stationCode: string
  date: string
}

/**
 * 出仓告警核心：拉到件索引运单 → 按供应商 routeCode/白名单过滤 → 建卡推送。
 * 供定时任务与「立刻推送」复用；不校验 weekdays / pushTimes。
 */
export async function executeExitAlarmPush(params: {
  token: string
  stationCode: string
  /** 目标工作日 YYYY-MM-DD */
  date: string
  pushTime: string
  configs: FleetSupplierPushConfig[]
  tz: AusTz
  label: string
}): Promise<ExitAlarmPushResult | { error: string }> {
  const { token, stationCode, date, pushTime, configs, tz, label } = params

  const result = await fetchWaybillDetailsByInboundIndex({
    token,
    stationCode,
    dateStr: date,
    tz,
    label,
  })
  if (!result.ok) {
    console.error(`${label} 运单查询失败: ${result.message}`)
    return { error: `运单查询失败: ${result.message}` }
  }

  const waybills = result.records
  const before11ThresholdMs = computeBefore11ThresholdMs(date, tz)
  let pushedCount = 0
  const errors: string[] = []

  for (const config of configs) {
    const routeCodes = parseRouteCodes(config.routeCode)
    const whitelist = parseRouteCodeWhitelistSet(config.routeCodeWhitelist)
    const vendorName = supplierDisplayName(config)

    const vendorWaybills = waybills.filter((w) => {
      const code = (w.consigneeRouteCode ?? '').trim()
      if (routeCodes.length > 0 && !routeCodes.includes(code)) return false
      if (whitelist.has(code)) return false
      return true
    })

    const zoneBreakdown = buildExitAlarmZoneBreakdown(vendorWaybills, before11ThresholdMs)
    const totalPending = Object.values(zoneBreakdown).reduce((s, v) => s + v.pending, 0)
    const card = buildExitAlarmCard({
      vendorName,
      stationCode,
      date,
      pushTime,
      zoneBreakdown,
      totalPending,
      totalWaybills: vendorWaybills.length,
      pushDescription: config.pushDescription,
    })

    const { ok, reason } = await pushCardToWebhook(config.webhookUrl, config.signingSecret, card)
    if (ok) {
      pushedCount++
      console.log(`${label} ✓ 推送成功: ${vendorName}`)
    } else {
      const detail = reason ? ` (${reason})` : ''
      console.error(`${label} ✗ 推送失败: ${vendorName}${detail}`)
      errors.push(`${vendorName}: ${reason ?? '推送失败'}`)
    }
  }

  return { pushedCount, totalConfigs: configs.length, errors, stationCode, date }
}

/** 处理单个账号的定时配置：命中推送时间则读取到件索引并执行告警推送 */
async function runOneScheduledPush(schedule: ExitAlarmSchedule, regionCode: string | null): Promise<void> {
  const label = `[exit-alarm/scheduler user=${schedule.userId}]`

  const stationCode = schedule.stationCode?.trim()
  if (!stationCode) return

  const tz = resolveRegionTz(regionCode)
  const weekdays = schedule.weekdays as number[]
  const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
  const dueSlots = resolveDueScheduledSlots({ tz, weekdays, pushTimes })
  if (dueSlots.length === 0) return

  for (const slot of dueSlots) {
    const { weekday, timeHHmm, prevDateStr } = slot
    const jobKey = `exit-alarm:${schedule.id}`
    const slotKey = formatScheduledPushSlotKey(slot)

    const rawToken = readExitAlarmImileToken(schedule)
    if (!rawToken) {
      console.warn(
        `${label} 命中推送时间 weekday=${weekday} time=${timeHHmm}，但缺少 iMile token，无法拉数推送`,
      )
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

    const result = await executeExitAlarmPush({
      token: rawToken,
      stationCode,
      date: targetDate,
      pushTime: timeHHmm,
      configs,
      tz,
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
export async function runExitAlarmScheduledPush(): Promise<void> {
  const label = '[exit-alarm/scheduler]'
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
