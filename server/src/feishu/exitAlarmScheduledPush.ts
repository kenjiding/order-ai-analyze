import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { ExitAlarmSchedule, FleetSupplierPushConfig } from '../db/schema'
import { buildExitAlarmCard } from './buildExitAlarmCard'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { envFirst } from '../imile/shared'
import { getGlobalImileToken } from './globalImileToken'
import { fetchWaybillDetailsByInboundIndex } from '../imile/inboundWaybillIndex'
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { computeBefore11ThresholdMs } from '../imile/before11Exit'
import {
  aggregateBefore11ByScopes,
  tagBefore11Rows,
  type Before11Scope,
} from '../vendorAnalysis/before11Aggregate'
import { buildScopeMapsFromConfig } from '../vendorAnalysis/supplierScope'
import { lastSortingWorkdayOnOrBefore } from '../imile/sortingWorkday'
import {
  listPushableSupplierPushConfigsForSchedule,
  parsePushConfigIds,
  supplierDisplayName,
} from '../supplierPushConfigs'
import {
  claimScheduledSlot,
  countClaimedSlots,
  formatScheduledPushSlotKey,
  releaseScheduledSlot,
} from '../jobs/scheduledClaim'
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

export async function readExitAlarmImileToken(
  schedule?: Pick<ExitAlarmSchedule, 'imileToken' | 'userId'> | null,
): Promise<string> {
  if (schedule?.userId) {
    const fromGlobalSettings = await getGlobalImileToken(schedule.userId)
    if (fromGlobalSettings) return fromGlobalSettings
  }
  const fromSchedule = schedule?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_EXIT_ALARM_TOKEN') ?? ''
}

export async function hasExitAlarmImileToken(
  schedule?: Pick<ExitAlarmSchedule, 'imileToken' | 'userId'> | null,
): Promise<boolean> {
  return (await readExitAlarmImileToken(schedule)).length > 0
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
      if (!(await hasExitAlarmImileToken(schedule))) {
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
  /** 各供应商本次推送中未在 11 点前出仓（未达标）的运单号，供前端导出 Excel */
  unqualifiedByVendor: { vendorName: string; waybillNos: string[] }[]
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
  /**
   * 仅供定时任务传入：按 (jobKeyPrefix:configId, slotKey) 对每个供应商配置单独做幂等去重。
   * 某个配置本次已经成功推送过则跳过，推送失败/暂无数据则释放，交给下次 catch-up 重试；
   * 「立刻推送」不传此参数，始终对全部 configs 重新执行，不受定时任务的去重状态影响。
   */
  perConfigDedupe?: { jobKeyPrefix: string; slotKey: string }
}): Promise<ExitAlarmPushResult | { error: string }> {
  const { token, stationCode, date, pushTime, configs, tz, label, perConfigDedupe } = params

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
  // 取数层：全量打标；过滤留给各配置业务侧（与供应商分析对称）
  const taggedRows = tagBefore11Rows({
    rows: waybills as Array<Record<string, unknown>>,
    before11ThresholdMs,
  })
  let pushedCount = 0
  const errors: string[] = []
  const unqualifiedByVendor: { vendorName: string; waybillNos: string[] }[] = []

  // 与「供应商数据分析」同一套归属口径：courierVendorCode 归属 → routeCode 纳入 → 白名单剔除。
  // 用 config.id 当 key 一次遍历 taggedRows 拿到全部配置的统计，不再对每条配置各自重新扫一遍全量到件运单。
  const scopes: Before11Scope[] = []
  for (const config of configs) {
    const vendorCode = config.vendorCode.trim()
    if (!vendorCode) continue
    const scope = buildScopeMapsFromConfig(config)
    scopes.push({
      key: config.id,
      vendorCode,
      routeCodes: scope.routeCodesByVendor.get(vendorCode),
      routeCodeWhitelist: scope.routeCodeWhitelistByVendor.get(vendorCode),
    })
  }
  const statsByConfigId = aggregateBefore11ByScopes({ rows: taggedRows, scopes })

  for (const config of configs) {
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
      const stat = statsByConfigId.get(config.id) ?? {
        totalWaybills: 0,
        zoneBreakdown: {},
        unqualifiedWaybillNos: [],
      }
      const totalPending = Object.values(stat.zoneBreakdown).reduce((s, v) => s + v.pending, 0)
      const card = buildExitAlarmCard({
        vendorName,
        stationCode,
        date,
        pushTime,
        tz,
        zoneBreakdown: stat.zoneBreakdown,
        totalPending,
        totalWaybills: stat.totalWaybills,
        pushDescription: config.pushDescription,
      })

      unqualifiedByVendor.push({ vendorName, waybillNos: stat.unqualifiedWaybillNos })

      const { ok, reason } = await pushCardToWebhook(config.webhookUrl, config.signingSecret, card)
      if (ok) {
        pushedCount++
        console.log(`${label} ✓ 推送成功: ${vendorName}`)
      } else {
        const detail = reason ? ` (${reason})` : ''
        console.error(`${label} ✗ 推送失败: ${vendorName}${detail}`)
        errors.push(`${vendorName}: ${reason ?? '推送失败'}`)
        if (dedupeJobKey) await releaseScheduledSlot(dedupeJobKey, perConfigDedupe!.slotKey)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${label} ✗ 处理异常: ${vendorName} (${msg})`)
      errors.push(`${vendorName}: 处理异常(${msg})`)
      if (dedupeJobKey) await releaseScheduledSlot(dedupeJobKey, perConfigDedupe!.slotKey)
    }
  }

  return { pushedCount, totalConfigs: configs.length, errors, stationCode, date, unqualifiedByVendor }
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
    const jobKeyPrefix = `exit-alarm:${schedule.id}`
    const slotKey = formatScheduledPushSlotKey(slot)

    const rawToken = await readExitAlarmImileToken(schedule)
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

    // 幂等粒度下沉到「每个供应商配置」：先快速判断本时间槽是否已全部推送成功，
    // 全部完成则跳过，避免 catch-up 重试窗口内每分钟都重新拉一遍到件数据。
    const configJobKeys = configs.map((c) => `${jobKeyPrefix}:${c.id}`)
    const claimedCount = await countClaimedSlots(configJobKeys, slotKey)
    if (claimedCount >= configs.length) {
      console.log(`${label} 时间槽 date=${slot.dateStr} time=${timeHHmm} 已全部推送成功，跳过`)
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
