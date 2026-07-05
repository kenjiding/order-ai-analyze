import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { ChaseDispatchSchedule, FleetSupplierPushConfig } from '../db/schema'
import { buildChaseDispatchCard } from './buildChaseDispatchCard'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { envFirst } from '../imile/shared'
import { getRegionNow } from '../imile/inboundWaybillIndex'
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { listPushableConfigsForScope } from '../supplierConfigScopes'
import { supplierDisplayName } from '../supplierPushConfigs'
import {
  computeStagnationRange,
  fetchStagnantWaybills,
  isStagnationBucket,
  type StagnationBucket,
} from '../imile/stagnantWaybills'
import { aggregateVendorStagnation, type BucketResult } from '../imile/chaseDispatchAggregate'

const CHASE_DISPATCH_SCOPE = 'chase-dispatch.scheduled' as const

type EnabledSchedule = { schedule: ChaseDispatchSchedule; regionCode: string | null }

async function listEnabledSchedules(): Promise<EnabledSchedule[]> {
  const db = getDb()
  return db
    .select({ schedule: schema.chaseDispatchSchedules, regionCode: schema.users.regionId })
    .from(schema.chaseDispatchSchedules)
    .leftJoin(schema.users, eq(schema.chaseDispatchSchedules.userId, schema.users.id))
    .where(eq(schema.chaseDispatchSchedules.isEnabled, true))
}

export function readChaseDispatchImileToken(
  schedule?: Pick<ChaseDispatchSchedule, 'imileToken'> | null,
): string {
  const fromSchedule = schedule?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_CHASE_DISPATCH_TOKEN') ?? ''
}

export function hasChaseDispatchImileToken(
  schedule?: Pick<ChaseDispatchSchedule, 'imileToken'> | null,
): boolean {
  return readChaseDispatchImileToken(schedule).length > 0
}

/** 解析 stagnationBuckets JSONB → 合法的滞留区间数组 */
export function parseStagnationBuckets(raw: unknown): StagnationBucket[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isStagnationBucket)
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

export type ChaseDispatchPushResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
}

/**
 * 催派推送核心：按选中的滞留区间分别拉数，再按每个供应商聚合并推送飞书卡片。
 * 供定时任务与「立即推送」复用。
 */
export async function executeChaseDispatchPush(params: {
  token: string
  stationCode: string
  baseDate: string
  pushTime: string
  buckets: StagnationBucket[]
  configs: FleetSupplierPushConfig[]
  label: string
}): Promise<ChaseDispatchPushResult | { error: string }> {
  const { token, stationCode, baseDate, pushTime, buckets, configs, label } = params

  // 每个滞留区间发起一次 daWaybillInventory 查询
  const bucketResults: BucketResult[] = []
  for (const bucket of buckets) {
    const { start, end } = computeStagnationRange(baseDate, bucket)
    const res = await fetchStagnantWaybills(token, {
      stationCodes: [stationCode],
      start,
      end,
    })
    if (!res.ok) {
      console.error(`${label} 滞留区间 ${bucket} 查询失败: ${res.message}`)
      return { error: `滞留区间 ${bucket} 查询失败: ${res.message}` }
    }
    bucketResults.push({ bucket, rows: res.data })
  }

  let pushedCount = 0
  const errors: string[] = []

  for (const config of configs) {
    const summary = aggregateVendorStagnation(bucketResults, config.vendorCode)
    const card = buildChaseDispatchCard({
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
export async function logChaseDispatchSchedulerReadiness(): Promise<void> {
  const label = '[chase-dispatch/scheduler]'
  try {
    const enabled = await listEnabledSchedules()
    if (enabled.length === 0) {
      console.log(`${label} 尚无已启用的定时配置，等待各账号页面保存后生效`)
      return
    }
    const scopedConfigs = await listPushableConfigsForScope(CHASE_DISPATCH_SCOPE)
    for (const { schedule, regionCode } of enabled) {
      if (!schedule.stationCode?.trim()) {
        console.warn(`${label} 配置 ${schedule.id} 已启用，但未保存站点编码 stationCode`)
      }
      if (!hasChaseDispatchImileToken(schedule)) {
        console.warn(`${label} 配置 ${schedule.id} 已启用，但缺少 iMile token`)
        continue
      }
      const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
      const weekdays = schedule.weekdays as number[]
      const buckets = parseStagnationBuckets(schedule.stagnationBuckets)
      console.log(
        `${label} 就绪 user=${schedule.userId} weekdays=[${weekdays.join(',')}] times=[${pushTimes
          .map((s) => s.time)
          .join(',')}] buckets=[${buckets.join(',')}] station=${schedule.stationCode} region=${
          regionCode ?? '(默认阿德莱德)'
        } scopedSuppliers=${scopedConfigs.length}`,
      )
    }
  } catch (err) {
    console.error(`${label} 启动自检失败:`, err)
  }
}

async function runOneScheduledPush(schedule: ChaseDispatchSchedule, regionCode: string | null): Promise<void> {
  const label = `[chase-dispatch/scheduler user=${schedule.userId}]`

  const stationCode = schedule.stationCode?.trim()
  if (!stationCode) return

  const tz: AusTz = resolveRegionTz(regionCode)
  const { weekday, timeHHmm, dateStr } = getRegionNow(tz)
  const weekdays = schedule.weekdays as number[]
  if (!weekdays.includes(weekday)) return

  const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
  if (!pushTimes.some((s) => s.time === timeHHmm)) return

  const buckets = parseStagnationBuckets(schedule.stagnationBuckets)
  if (buckets.length === 0) {
    console.log(`${label} 命中推送时间但未选择滞留时间，跳过`)
    return
  }

  const token = readChaseDispatchImileToken(schedule)
  if (!token) {
    console.warn(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm}，但缺少 iMile token`)
    return
  }

  console.log(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm} baseDate=${dateStr}`)

  const configs = await listPushableConfigsForScope(CHASE_DISPATCH_SCOPE)
  if (configs.length === 0) {
    console.log(`${label} 无参与催派推送的供应商，跳过（请在「催派推送」启用供应商）`)
    return
  }

  const result = await executeChaseDispatchPush({
    token,
    stationCode,
    baseDate: dateStr,
    pushTime: timeHHmm,
    buckets,
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
export async function runChaseDispatchScheduledPush(): Promise<void> {
  const label = '[chase-dispatch/scheduler]'
  const enabled = await listEnabledSchedules()
  for (const { schedule, regionCode } of enabled) {
    try {
      await runOneScheduledPush(schedule, regionCode)
    } catch (err) {
      console.error(`${label} 配置 ${schedule.id}（user=${schedule.userId}）推送异常:`, err)
    }
  }
}
