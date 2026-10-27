import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { DispatchAlarmSchedule, FleetSupplierPushConfig } from '../db/schema'
import { buildDispatchAlarmCard, buildDispatchAlarmRankingCard, rankDispatch24h } from './buildDispatchAlarmCard'
import { buildImportantNoticeCard, parseSupplierMentionContacts, pickMentions } from './feishuMentionHelpers'
import { createDispatchAlarmShareSnapshot } from './dispatchAlarmShareSnapshot'
import { sendSupplierPushCard } from './sendSupplierPushCard'
import { recordFeishuPushMessage } from './pushMessageRepository'
import { envFirst } from '../imile/shared'
import { getGlobalImileToken } from './globalImileToken'
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { fetchDriverWaybills } from '../imile/driverPerformance'
import {
  listPushableSupplierPushConfigsForSchedule,
  parsePushConfigIds,
  supplierDisplayName,
} from '../supplierPushConfigs'
import { buildConfigScope, buildSupplierUnitKey, normCode } from '../vendorAnalysis/supplierScope'
import { loadPriorityClientCodes } from '../priorityClients'
import {
  aggregateDispatch24hByScopes,
  resolveDispatch24hWindowRule,
  type Dispatch24hScope,
  type Dispatch24hWaybillRow,
} from '../vendorAnalysis/dispatch24hAggregate'
import {
  isNoSortingBatch,
  sortingWorkdayCatchUpDates,
} from '../imile/sortingWorkday'
import { resolveMinSortingWaybills } from '../dispatch24hStats/configRepository'
import {
  claimScheduledSlot,
  countClaimedSlots,
  formatScheduledPushSlotKey,
  releaseScheduledSlot,
} from '../jobs/scheduledClaim'
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

export async function readDispatchAlarmImileToken(
  schedule?: Pick<DispatchAlarmSchedule, 'imileToken' | 'userId'> | null,
): Promise<string> {
  if (schedule?.userId) {
    const fromGlobalSettings = await getGlobalImileToken(schedule.userId)
    if (fromGlobalSettings) return fromGlobalSettings
  }
  const fromSchedule = schedule?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_DISPATCH_ALARM_TOKEN') ?? ''
}

export async function hasDispatchAlarmImileToken(
  schedule?: Pick<DispatchAlarmSchedule, 'imileToken' | 'userId'> | null,
): Promise<boolean> {
  return (await readDispatchAlarmImileToken(schedule)).length > 0
}

export type DispatchAlarmPushResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
  stationCode: string
  /** 本次统计的到件日列表（可多日合并） */
  dates: string[]
  /** 到件量低于 MIN_SORTING_WAYBILLS：这天没开仓分拣，没有批次可推 */
  noBatch?: boolean
}

/**
 * 24H 派签告警核心：拉前一日司机运单 → 按「本配置」vendorCode + routeCode 纳入 + 白名单剔除后聚合
 * （复用 vendorAnalysis/dispatch24hAggregate）→ 逐配置推送（无数据则跳过）。
 * 同一 vendorCode、不同 routeCode 的多条配置各自独立统计，互不混算。
 */
export async function executeDispatchAlarmPush(params: {
  token: string
  stationCode: string
  /** 到件日 YYYY-MM-DD，可多日；多日按运单号去重合并，每行沿用自己那天的 24H 窗口口径 */
  dates: string[]
  pushTime: string
  alertThresholdPct: number
  configs: FleetSupplierPushConfig[]
  tz: AusTz
  /** 与 tz 同源的账号 regionCode；透传给 fetchDriverWaybills，避免其内部缓存终态判定兜底成阿德莱德、与本次聚合口径的 tz 不一致 */
  regionCode: string | null
  label: string
  /** 是否 @ 供应商配置花名册第 1 位联系人；默认 false */
  mentionEnabled?: boolean
  /** 是否在落地页展示「司机地图」组件；默认 false */
  showDriverMap?: boolean
  /** 是否剔除路由码白名单数据；默认 true。false 时白名单运单照常计入统计与落地页 */
  excludeWhitelist?: boolean
  /** 重要提醒：填了就原样追加在卡片末尾，@ 人拼在它后面 */
  importantNotice?: string | null
  /** 是否在每张数据卡片后紧跟一张同站点供应商的实时排名卡（发到同一个供应商群） */
  rankingCardEnabled?: boolean
  /** 排名卡标题用的站点展示名；为空时用 stationCode */
  stationName?: string | null
  /**
   * 仅供定时任务传入：按 (jobKeyPrefix:configId, slotKey) 对每个供应商配置单独做幂等去重。
   * 某个配置本次已经成功推送过则跳过，推送失败则释放交给下次 catch-up 重试；
   * 「无数据不推送」不算完成，不会被 claim，留给下次重新判断。
   * 「立刻推送」不传此参数，始终对全部 configs 重新执行。
   */
  perConfigDedupe?: { jobKeyPrefix: string; slotKey: string }
}): Promise<DispatchAlarmPushResult | { error: string }> {
  const {
    token,
    stationCode,
    dates,
    pushTime,
    alertThresholdPct,
    configs,
    tz,
    regionCode,
    label,
    mentionEnabled,
    showDriverMap,
    excludeWhitelist,
    importantNotice,
    rankingCardEnabled,
    stationName,
    perConfigDedupe,
  } = params

  if (dates.length === 0) return { error: '未指定到件扫描日期' }

  // 多到件日：逐日拉数，每行带上自己那天的窗口规则（周五/周末批次是固定截止，不能整批共用一个规则），
  // 再按运单号去重合并（同一单出现在多天索引时以较早到件日的批次为准）
  const rowByWaybillNo = new Map<string, Dispatch24hWaybillRow>()
  for (const dateStr of dates) {
    const result = await fetchDriverWaybills(token, { stationCode, dateStr, regionCode, forceIndexRefresh: true })
    if (!result.ok) {
      console.error(`${label} 到件日 ${dateStr} 运单查询失败: ${result.message}`)
      return { error: `到件日 ${dateStr} 运单查询失败: ${result.message}` }
    }
    const windowRule = resolveDispatch24hWindowRule(dateStr, tz)
    for (const row of result.data as Dispatch24hWaybillRow[]) {
      const key = row.waybillNo?.trim() || `__idx_${rowByWaybillNo.size}`
      if (!rowByWaybillNo.has(key)) rowByWaybillNo.set(key, { ...row, windowRule })
    }
  }

  const rows = [...rowByWaybillNo.values()]

  // 这天没开仓分拣：值班员工零星扫入库的几十单不构成批次，派签率的分母毫无意义。
  // 不 claim 时间槽，日志留量便于核对阈值。
  // 阈值按站点覆盖（见 dispatch24hStats/configRepository.ts resolveMinSortingWaybills）：
  // 全局阈值是照大站点定的，小站点正常营业量可能常年卡在阈值以下，需要各站点自己的数。
  const minSortingWaybills = await resolveMinSortingWaybills(stationCode)
  if (isNoSortingBatch(rows.length, minSortingWaybills)) {
    console.log(
      `${label} 到件日 ${dates.join(',')} 仅 ${rows.length} 单（< ${minSortingWaybills}），` +
        '判定当天未开仓分拣，跳过推送',
    )
    return { pushedCount: 0, totalConfigs: configs.length, errors: [], stationCode, dates, noBatch: true }
  }

  const dateLabel = dates.join(' ～ ')
  let pushedCount = 0
  const errors: string[] = []

  // 按配置独立过滤：避免同供应商多区域（不同 routeCode）共用一份聚合结果。
  // 用 config.id 当 key（而非 vendorCode）一次遍历 rows 拿到全部配置的统计，
  // 不再对每条配置各自重新扫一遍全量运单——大站点几万条时这是聚合阶段的主要开销。
  // 未选供应商的配置（vendorCode 为空）走纯路由码口径，由 buildConfigScope 统一判定
  // 不剔除白名单时把白名单清空即可：聚合与落地页共用这份 scope，口径自动一致
  const scopes: Dispatch24hScope[] = configs.map((config) => {
    const scope = buildConfigScope(config.id, config)
    return excludeWhitelist === false ? { ...scope, routeCodeWhitelist: undefined } : scope
  })
  const scopeByConfigId = new Map(scopes.map((scope) => [scope.key, scope]))
  // 兜底规则（每行已带 windowRule，实际不会用到）：取第一个到件日
  const rule = resolveDispatch24hWindowRule(dates[0], tz)
  // 「本地件优先客户」名单来自「优先客户配置」页面，每次推送读一次即可（配置量小）
  const priorityClientCodes = await loadPriorityClientCodes()
  const statsByConfigId = aggregateDispatch24hByScopes({
    rows,
    stationCodes: [stationCode],
    rule,
    scopes,
    priorityClientCodes,
  })

  // 同站点实时排名：与卡片上的 24H 派签率同一次统计、同一口径，不额外拉数。
  // 同一家被勾了多条配置（如多个 region 各一条）按供应商单位去重，保留单量大的那条，避免一家占两个名次
  const supplierKeyOf = (config: FleetSupplierPushConfig) =>
    buildSupplierUnitKey(normCode(config.vendorCode), supplierDisplayName(config))
  const poolByKey = new Map<string, { key: string; name: string; total: number; met: number }>()
  for (const config of configs) {
    const stat = statsByConfigId.get(config.id)
    if (!stat || stat.total === 0) continue
    const key = supplierKeyOf(config)
    const existing = poolByKey.get(key)
    if (!existing || stat.total > existing.total) {
      poolByKey.set(key, { key, name: supplierDisplayName(config), total: stat.total, met: stat.met })
    }
  }
  const rankEntries = rankDispatch24h([...poolByKey.values()])
  // 同一次推送各家看到的是同一张排名，构建一次复用；只有 1 家时没有可比性，不发
  const rankingCard =
    rankingCardEnabled && rankEntries.length >= 2
      ? buildDispatchAlarmRankingCard({
          stationName: stationName?.trim() || stationCode,
          date: dateLabel,
          pushTime,
          tz,
          alertThresholdPct,
          entries: rankEntries,
        })
      : null

  for (const config of configs) {
    const stat = statsByConfigId.get(config.id)
    if (!stat || stat.total === 0) continue // 无数据不推送；不 claim，留给下次重新判断

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
      const share =
        stat.total - stat.met > 0 || stat.problemCount > 0
          ? await createDispatchAlarmShareSnapshot({
              vendorCode: config.vendorCode,
              // 落地页的司机地图靠这两个字段再按路由码收窄，口径与本次统计完全一致
              routeCodes: [...(scopeByConfigId.get(config.id)?.routeCodes ?? [])],
              routeCodeWhitelist: [...(scopeByConfigId.get(config.id)?.routeCodeWhitelist ?? [])],
              vendorName,
              stationCode,
              date: dateLabel,
              pushTime,
              total: stat.total,
              met: stat.met,
              problemCount: stat.problemCount,
              alertThresholdPct,
              drivers: stat.drivers,
              unassigned: stat.unassigned,
              showDriverMap: Boolean(showDriverMap),
              dataDates: dates,
            })
          : null

      const mentions = pickMentions(parseSupplierMentionContacts(config.mentionOpenIds), Boolean(mentionEnabled))
      const noticeText = (importantNotice ?? '').trim()
      const card = buildDispatchAlarmCard({
        vendorName,
        date: dateLabel,
        pushTime,
        tz,
        total: stat.total,
        met: stat.met,
        problemCount: stat.problemCount,
        neverSignedCount: stat.neverSignedCount,
        lateSignedCount: stat.lateSignedCount,
        priorityTotal: stat.priorityTotal,
        priorityUnsigned: stat.priorityUnsigned,
        drivers: stat.drivers,
        unassigned: stat.unassigned,
        alertThresholdPct,
        pushDescription: config.pushDescription,
        detailUrl: share?.url ?? null,
        // 填了重要提醒时 @ 人挪到提醒那条消息里，数据卡片不再 @
        mentions: noticeText ? [] : mentions,
        supplierConfigId: config.id,
      })
      const { ok, reason, messageId, chatId } = await sendSupplierPushCard(config, card)
      if (ok) {
        // 实时排名卡紧跟数据卡片发到同一个群。数据卡片已发出且已 claim 时间槽，
        // 排名卡发失败只记错误、不释放时间槽（否则下次会重发数据卡片）
        if (rankingCard) {
          const rankingRes = await sendSupplierPushCard(config, rankingCard)
          if (!rankingRes.ok) {
            console.error(`${label} ✗ 实时排名卡推送失败: ${vendorName} (${rankingRes.reason ?? '未知'})`)
            errors.push(`${vendorName}: 实时排名卡推送失败(${rankingRes.reason ?? '未知'})`)
          }
        }
        // 「重要提醒」不融进数据卡片，紧接着单独发一条；此时 @ 人也跟着挪到这条里。
        // 数据卡片已发出且已 claim 时间槽，提醒发失败只记错误、不释放时间槽（否则下次会重发数据卡片）。
        if (noticeText) {
          const noticeRes = await sendSupplierPushCard(config, buildImportantNoticeCard(noticeText, mentions))
          if (!noticeRes.ok) {
            console.error(`${label} ✗ 重要提醒推送失败: ${vendorName} (${noticeRes.reason ?? '未知'})`)
            errors.push(`${vendorName}: 重要提醒推送失败(${noticeRes.reason ?? '未知'})`)
          }
        }
        pushedCount++
        void recordFeishuPushMessage({ supplierConfigId: config.id, chatId, messageId, pushLabel: '24H派签告警' })
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

  return { pushedCount, totalConfigs: configs.length, errors, stationCode, dates }
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
      if (!(await hasDispatchAlarmImileToken(schedule))) {
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
    const { weekday, timeHHmm, prevDateStr } = slot
    const jobKeyPrefix = `dispatch-alarm:${schedule.id}`
    const slotKey = formatScheduledPushSlotKey(slot)

    const token = await readDispatchAlarmImileToken(schedule)
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

    // 幂等粒度下沉到「每个供应商配置」：先快速判断本时间槽是否已全部推送成功，
    // 全部完成则跳过，避免 catch-up 重试窗口内每分钟都重新拉一遍运单数据。
    const configJobKeys = configs.map((c) => `${jobKeyPrefix}:${c.id}`)
    const claimedCount = await countClaimedSlots(configJobKeys, slotKey)
    if (claimedCount >= configs.length) {
      console.log(`${label} 时间槽 date=${slot.dateStr} time=${timeHHmm} 已全部推送成功，跳过`)
      continue
    }

    // 目标日避开周末（周六/日不分拣、无数据）：从前一日往前取第一个工作日，中间跳过的周末日
    // 一并带上（见 sortingWorkdayCatchUpDates）——没开仓就是没数据，真开仓时不漏算。
    // 周六/周日推的仍是周五那批的实时进度（那批派签截止在下周一 23:59:59）。
    // 这天没开仓分拣的情形由量判定接手（见 execute）。
    const targetDates = sortingWorkdayCatchUpDates(prevDateStr)
    console.log(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm} dates=${targetDates.join(',')}`)

    const result = await executeDispatchAlarmPush({
      token,
      stationCode,
      dates: targetDates,
      pushTime: timeHHmm,
      alertThresholdPct: schedule.alertThresholdPct,
      configs,
      tz,
      regionCode,
      label,
      mentionEnabled: schedule.mentionEnabled,
      showDriverMap: schedule.showDriverMap,
      excludeWhitelist: schedule.excludeWhitelist,
      importantNotice: schedule.importantNotice,
      rankingCardEnabled: schedule.rankingCardEnabled,
      stationName: schedule.stationName,
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
