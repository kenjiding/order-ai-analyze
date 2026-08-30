import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { ChaseDispatchSchedule, FleetSupplierPushConfig } from '../db/schema'
import { buildChaseDispatchCard } from './buildChaseDispatchCard'
import { parseSupplierMentionContacts, pickMentions } from './feishuMentionHelpers'
import { sendSupplierPushCard } from './sendSupplierPushCard'
import { envFirst } from '../imile/shared'
import { getGlobalImileToken } from './globalImileToken'
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import {
  listPushableSupplierPushConfigsForSchedule,
  parsePushConfigIds,
  parseRouteCodes,
  supplierDisplayName,
} from '../supplierPushConfigs'
import {
  computeStagnationRange,
  fetchStagnantWaybillRouteCodes,
  fetchStagnantWaybills,
  isStagnationBucket,
  type StagnantWaybillRow,
  type StagnationBucket,
} from '../imile/stagnantWaybills'
import { aggregateVendorStagnation, type BucketResult } from '../imile/chaseDispatchAggregate'
import { filterWaybillsWithExistingTicket } from '../imile/chaseDispatchTicketCheck'
import {
  claimScheduledSlot,
  countClaimedSlots,
  formatScheduledPushSlotKey,
  releaseScheduledSlot,
} from '../jobs/scheduledClaim'
import { resolveDueScheduledSlots } from '../jobs/scheduledDueSlots'
import { createChaseDispatchShareSnapshot } from './chaseDispatchShareSnapshot'
import { recordFeishuPushMessage } from './pushMessageRepository'

type EnabledSchedule = { schedule: ChaseDispatchSchedule; regionCode: string | null }

async function listEnabledSchedules(): Promise<EnabledSchedule[]> {
  const db = getDb()
  return db
    .select({ schedule: schema.chaseDispatchSchedules, regionCode: schema.users.regionId })
    .from(schema.chaseDispatchSchedules)
    .leftJoin(schema.users, eq(schema.chaseDispatchSchedules.userId, schema.users.id))
    .where(eq(schema.chaseDispatchSchedules.isEnabled, true))
}

export async function readChaseDispatchImileToken(
  schedule?: Pick<ChaseDispatchSchedule, 'imileToken' | 'userId'> | null,
): Promise<string> {
  if (schedule?.userId) {
    const fromGlobalSettings = await getGlobalImileToken(schedule.userId)
    if (fromGlobalSettings) return fromGlobalSettings
  }
  const fromSchedule = schedule?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_CHASE_DISPATCH_TOKEN') ?? ''
}

export async function hasChaseDispatchImileToken(
  schedule?: Pick<ChaseDispatchSchedule, 'imileToken' | 'userId'> | null,
): Promise<boolean> {
  return (await readChaseDispatchImileToken(schedule)).length > 0
}

/** 解析 stagnationBuckets JSONB → 合法的滞留区间数组 */
export function parseStagnationBuckets(raw: unknown): StagnationBucket[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isStagnationBucket)
}

export type ChaseDispatchPushResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
}

/**
 * 催派推送核心：按滞留区间拉数 → searchWaybill 查路由码 → 按供应商 vendorCode + routeCode 筛选后推送。
 * 供定时任务复用。不使用路由码白名单。
 */
export async function executeChaseDispatchPush(params: {
  token: string
  stationCode: string
  baseDate: string
  pushTime: string
  tz: AusTz
  buckets: StagnationBucket[]
  configs: FleetSupplierPushConfig[]
  label: string
  /** 是否 @ 供应商配置花名册第 1 位联系人；默认 false */
  mentionEnabled?: boolean
  /**
   * 仅供定时任务传入：按 (jobKeyPrefix:configId, slotKey) 对每个供应商配置单独做幂等去重。
   * 「立刻推送」不传此参数，始终对全部 configs 重新执行。
   */
  perConfigDedupe?: { jobKeyPrefix: string; slotKey: string }
}): Promise<ChaseDispatchPushResult | { error: string }> {
  const { token, stationCode, baseDate, pushTime, tz, buckets, configs, label, mentionEnabled, perConfigDedupe } =
    params

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

  // "≥7 天"已有关联工单（如起诉罚款）的运单视为已处理，飞书推送中不再展示
  const sevenPlusIndex = bucketResults.findIndex((b) => b.bucket === '7+')
  if (sevenPlusIndex !== -1) {
    const sevenPlusRows = bucketResults[sevenPlusIndex].rows
    const sevenPlusWaybillNos = sevenPlusRows.map((row) => row.waybillNo ?? '').filter(Boolean)
    const ticketedWaybills = await filterWaybillsWithExistingTicket(token, sevenPlusWaybillNos, stationCode, label)
    if (ticketedWaybills.size > 0) {
      console.log(`${label} ≥7 天已有关联工单，过滤 ${ticketedWaybills.size}/${sevenPlusWaybillNos.length} 条`)
      bucketResults[sevenPlusIndex] = {
        bucket: '7+',
        rows: sevenPlusRows.filter((row) => !ticketedWaybills.has((row.waybillNo ?? '').trim())),
      }
    }
  }

  // 先按启用供应商的 vendorCode 收窄，再收集运单号查 searchWaybill 路由码
  const enabledVendorCodes = new Set(
    configs.map((c) => c.vendorCode.trim()).filter((code) => code.length > 0),
  )
  const vendorScopedWaybillNos = bucketResults.flatMap((b) =>
    b.rows
      .filter((row) => enabledVendorCodes.has((row.driverVendorCode ?? '').trim()))
      .map((row) => row.waybillNo ?? ''),
  )
  const routeCodeResult = await fetchStagnantWaybillRouteCodes(token, vendorScopedWaybillNos, stationCode)
  if (!routeCodeResult.ok) {
    console.error(`${label} 路由码查询失败: ${routeCodeResult.message}`)
    return { error: `路由码查询失败: ${routeCodeResult.message}` }
  }
  const routeCodeByWaybillNo = routeCodeResult.data

  const filterRowsByRouteCode = (rows: StagnantWaybillRow[], allowed: Set<string>): StagnantWaybillRow[] => {
    if (allowed.size === 0) return []
    return rows.filter((row) => {
      const routeCode = routeCodeByWaybillNo.get((row.waybillNo ?? '').trim()) ?? ''
      return allowed.has(routeCode)
    })
  }

  let pushedCount = 0
  const errors: string[] = []

  for (const config of configs) {
    const vendorCode = config.vendorCode.trim()
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
      const allowedRouteCodes = new Set(parseRouteCodes(config.routeCode))
      // 该供应商明细：vendorCode 归属 → routeCode 纳入（不用路由码白名单）
      const configBucketResults = bucketResults.map((b) => {
        const byVendor = b.rows.filter((row) => (row.driverVendorCode ?? '').trim() === vendorCode)
        return { bucket: b.bucket, rows: filterRowsByRouteCode(byVendor, allowedRouteCodes) }
      })
      const summary = aggregateVendorStagnation(configBucketResults, config.vendorCode, routeCodeByWaybillNo)
      const share =
        summary.totalStagnant > 0
          ? await createChaseDispatchShareSnapshot({
              vendorCode: config.vendorCode,
              vendorName,
              baseDate,
              pushTime,
              summary,
            })
          : null
      const mentions = pickMentions(parseSupplierMentionContacts(config.mentionOpenIds), Boolean(mentionEnabled))
      const card = buildChaseDispatchCard({
        vendorName,
        baseDate,
        pushTime,
        tz,
        summary,
        pushDescription: config.pushDescription,
        detailUrl: share?.url ?? null,
        mentions,
        supplierConfigId: config.id,
      })
      const { ok, reason, messageId, chatId } = await sendSupplierPushCard(config, card)
      if (ok) {
        pushedCount++
        void recordFeishuPushMessage({ supplierConfigId: config.id, chatId, messageId, pushLabel: '催派推送' })
      } else {
        errors.push(`${vendorName}: ${reason ?? '飞书推送失败'}`)
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
export async function logChaseDispatchSchedulerReadiness(): Promise<void> {
  const label = '[chase-dispatch/scheduler]'
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
      if (!(await hasChaseDispatchImileToken(schedule))) {
        console.warn(`${label} 配置 ${schedule.id} 已启用，但缺少 iMile token`)
        continue
      }
      const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
      const weekdays = schedule.weekdays as number[]
      const buckets = parseStagnationBuckets(schedule.stagnationBuckets)
      const scopedCount = parsePushConfigIds(schedule.pushConfigIds).length
      console.log(
        `${label} 就绪 user=${schedule.userId} weekdays=[${weekdays.join(',')}] times=[${pushTimes
          .map((s) => s.time)
          .join(',')}] buckets=[${buckets.join(',')}] station=${schedule.stationCode} region=${
          regionCode ?? '(默认阿德莱德)'
        } scopedSuppliers=${scopedCount}`,
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
  const weekdays = schedule.weekdays as number[]
  const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
  const dueSlots = resolveDueScheduledSlots({
    tz,
    weekdays,
    pushTimes,
    // 配置刚保存/刚启用时，早于保存那一分钟的时间槽从未生效过，不能当成「漏跑」补发
    effectiveSince: schedule.updatedAt,
    label,
  })
  if (dueSlots.length === 0) return

  for (const slot of dueSlots) {
    const { weekday, timeHHmm, dateStr } = slot
    const jobKeyPrefix = `chase-dispatch:${schedule.id}`
    const slotKey = formatScheduledPushSlotKey(slot)

    const buckets = parseStagnationBuckets(schedule.stagnationBuckets)
    if (buckets.length === 0) {
      console.log(`${label} 命中推送时间但未选择滞留时间，跳过`)
      continue
    }

    const token = await readChaseDispatchImileToken(schedule)
    if (!token) {
      console.warn(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm}，但缺少 iMile token`)
      continue
    }

    const configs = await listPushableSupplierPushConfigsForSchedule(parsePushConfigIds(schedule.pushConfigIds), {
      regionCode,
      stationCode,
    })
    if (configs.length === 0) {
      console.log(`${label} 无参与催派推送的供应商，跳过（请在该条目的「供应商配置」启用供应商）`)
      continue
    }

    // 幂等粒度下沉到「每个供应商配置」：先快速判断本时间槽是否已全部推送成功，
    // 全部完成则跳过，避免 catch-up 重试窗口内每分钟都重新拉一遍滞留数据。
    const configJobKeys = configs.map((c) => `${jobKeyPrefix}:${c.id}`)
    const claimedCount = await countClaimedSlots(configJobKeys, slotKey)
    if (claimedCount >= configs.length) {
      console.log(`${label} 时间槽 date=${dateStr} time=${timeHHmm} 已全部推送成功，跳过`)
      continue
    }

    console.log(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm} baseDate=${dateStr}`)

    const result = await executeChaseDispatchPush({
      token,
      stationCode,
      baseDate: dateStr,
      pushTime: timeHHmm,
      tz,
      buckets,
      configs,
      label,
      mentionEnabled: schedule.mentionEnabled,
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
export async function runChaseDispatchScheduledPush(): Promise<void> {
  const label = '[chase-dispatch/scheduler]'
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
