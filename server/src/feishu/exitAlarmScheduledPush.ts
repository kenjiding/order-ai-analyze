import { asc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { ExitAlarmSchedule } from '../db/schema'
import { buildExitAlarmCard } from './buildExitAlarmCard'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { envFirst } from '../imile/shared'
import {
  EXIT_ALARM_INBOUND_PREFETCH_TIME,
  fetchExitAlarmWaybills,
  fetchInboundWaybillNos,
  getAdelaideNow,
  readCachedInboundWaybillNos,
  saveInboundWaybillCache,
} from '../imile/exitAlarmWaybills'

export function readExitAlarmImileToken(schedule?: Pick<ExitAlarmSchedule, 'imileToken'> | null): string {
  const fromSchedule = schedule?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_EXIT_ALARM_TOKEN') ?? ''
}

export function hasExitAlarmImileToken(schedule?: Pick<ExitAlarmSchedule, 'imileToken'> | null): boolean {
  return readExitAlarmImileToken(schedule).length > 0
}

/** 解析路由码字符串：支持空格、换行、英文逗号、中文逗号分隔 */
export function parseRouteCodes(raw: string): string[] {
  return raw
    .split(/[\s,，]+/)
    .map((r) => r.trim())
    .filter(Boolean)
}

/** worker 启动时检查定时推送前置条件，便于排查「配置了但不执行」 */
export async function logExitAlarmSchedulerReadiness(): Promise<void> {
  const label = '[exit-alarm/scheduler]'
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.exitAlarmSchedules)
      .orderBy(asc(schema.exitAlarmSchedules.createdAt))
      .limit(1)
    const schedule = rows[0]
    if (!schedule) {
      console.log(`${label} 尚无定时配置，等待页面保存后生效`)
      return
    }
    if (!schedule.isEnabled) {
      console.log(`${label} 定时配置已保存但未启用`)
      return
    }
    if (!schedule.stationCode?.trim()) {
      console.warn(`${label} 定时配置已启用，但未保存站点编码 stationCode`)
    }
    if (!hasExitAlarmImileToken(schedule)) {
      console.warn(
        `${label} 定时配置已启用，但缺少 iMile token（保存配置时需携带全局 token，或设置 IMILE_EXIT_ALARM_TOKEN）`,
      )
      return
    }
    const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
    const weekdays = schedule.weekdays as number[]
    console.log(
      `${label} 就绪 weekdays=[${weekdays.join(',')}] times=[${pushTimes.map((s) => s.time).join(',')}] prefetch=${EXIT_ALARM_INBOUND_PREFETCH_TIME} station=${schedule.stationCode}`,
    )
  } catch (err) {
    console.error(`${label} 启动自检失败:`, err)
  }
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

async function runInboundPrefetch(
  schedule: ExitAlarmSchedule,
  prevDateStr: string,
  rawToken: string,
): Promise<void> {
  const label = '[exit-alarm/scheduler/prefetch]'
  const stationCode = schedule.stationCode.trim()
  const cached = readCachedInboundWaybillNos(schedule, prevDateStr)
  if (cached) {
    console.log(`${label} 已有缓存 date=${prevDateStr} count=${cached.length}，跳过`)
    return
  }

  console.log(`${label} 开始预取到件 date=${prevDateStr} station=${stationCode}`)
  const inbound = await fetchInboundWaybillNos({
    token: rawToken,
    stationCode,
    dateStr: prevDateStr,
    label: '出仓告警到件预取',
  })
  if (!inbound.ok) {
    console.error(`${label} 到件预取失败: ${inbound.message}`)
    return
  }

  await saveInboundWaybillCache({
    scheduleId: schedule.id,
    dateStr: prevDateStr,
    waybillNos: inbound.waybillNos,
  })
  console.log(`${label} 完成 date=${prevDateStr} waybillNos=${inbound.waybillNos.length}`)
}

/** 每分钟由 scheduler 调用；6:00 预取到件，命中推送时间则执行告警推送 */
export async function runExitAlarmScheduledPush(): Promise<void> {
  const label = '[exit-alarm/scheduler]'

  const db = getDb()
  const rows = await db
    .select()
    .from(schema.exitAlarmSchedules)
    .orderBy(asc(schema.exitAlarmSchedules.createdAt))
    .limit(1)
  const schedule = rows[0]
  if (!schedule?.isEnabled) return

  const stationCode = schedule.stationCode?.trim()
  if (!stationCode) {
    console.warn(`${label} 未配置站点编码 stationCode，跳过`)
    return
  }

  const { weekday, timeHHmm, prevDateStr } = getAdelaideNow()
  const weekdays = schedule.weekdays as number[]
  if (!weekdays.includes(weekday)) return

  const rawToken = readExitAlarmImileToken(schedule)

  if (timeHHmm === EXIT_ALARM_INBOUND_PREFETCH_TIME) {
    if (!rawToken) {
      console.warn(`${label} 命中到件预取时间但缺少 iMile token，跳过`)
    } else {
      await runInboundPrefetch(schedule, prevDateStr, rawToken)
    }
  }

  const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
  const matchedSlot = pushTimes.find((s) => s.time === timeHHmm)
  if (!matchedSlot) return

  if (!rawToken) {
    console.warn(
      `${label} 命中推送时间 weekday=${weekday} time=${timeHHmm}，但缺少 iMile token，无法拉数推送`,
    )
    return
  }

  console.log(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm} date=${prevDateStr}`)

  const configs = await db
    .select()
    .from(schema.exitAlarmPushConfigs)
    .where(eq(schema.exitAlarmPushConfigs.isDisabled, false))
    .orderBy(asc(schema.exitAlarmPushConfigs.createdAt))

  if (configs.length === 0) {
    console.log(`${label} 无已启用的供应商推送配置，跳过`)
    return
  }

  const cachedWaybillNos = readCachedInboundWaybillNos(schedule, prevDateStr)
  const result = await fetchExitAlarmWaybills({
    token: rawToken,
    stationCode,
    dateStr: prevDateStr,
    label: '出仓告警定时推送',
    cachedWaybillNos,
    scheduleId: schedule.id,
    persistInboundCache: !cachedWaybillNos,
  })

  if (!result.ok) {
    console.error(`${label} 运单查询失败: ${result.message}`)
    return
  }

  const waybills = result.records

  let pushedCount = 0
  for (const config of configs) {
    const routeCodes = parseRouteCodes(config.routeCode)

    const vendorWaybills =
      routeCodes.length > 0
        ? waybills.filter((w) => routeCodes.includes((w.consigneeRouteCode ?? '').trim()))
        : waybills

    const zoneBreakdown: Record<string, { pending: number; total: number }> = {}
    for (const w of vendorWaybills) {
      const zone = (w.consigneeRouteCode ?? '').trim() || 'Unknown route'
      if (!zoneBreakdown[zone]) zoneBreakdown[zone] = { pending: 0, total: 0 }
      zoneBreakdown[zone].total++
      if (!w.deliveryTime) zoneBreakdown[zone].pending++
    }

    const totalPending = Object.values(zoneBreakdown).reduce((s, v) => s + v.pending, 0)
    const card = buildExitAlarmCard({
      vendorName: config.vendorName,
      stationCode,
      date: prevDateStr,
      pushTime: timeHHmm,
      zoneBreakdown,
      totalPending,
      totalWaybills: vendorWaybills.length,
      pushDescription: config.pushDescription,
    })

    const ok = await pushCardToWebhook(config.webhookUrl, config.signingSecret, card)
    if (ok) {
      pushedCount++
      console.log(`${label} ✓ 推送成功: ${config.vendorName}`)
    } else {
      console.error(`${label} ✗ 推送失败: ${config.vendorName}`)
    }
  }

  console.log(`${label} 完成 ${pushedCount}/${configs.length} 条`)
}
