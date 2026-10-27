import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { ExitAlarmSchedule, FleetSupplierPushConfig } from '../db/schema'
import { buildExitAlarmCard } from './buildExitAlarmCard'
import { buildImportantNoticeCard, parseSupplierMentionContacts, pickMentions } from './feishuMentionHelpers'
import { sendSupplierPushCard } from './sendSupplierPushCard'
import { recordFeishuPushMessage } from './pushMessageRepository'
import { envFirst } from '../imile/shared'
import { getGlobalImileToken } from './globalImileToken'
import { fetchExitAlarmWaybillRecords } from '../imile/ofdReport'
import { resolveRegionTz, type AusTz } from '../imile/ausTimezone'
import { computeThresholdMsOnDate } from '../imile/before11Exit'
import {
  aggregateBefore11ByScopes,
  tagBefore11Rows,
  type Before11Scope,
} from '../vendorAnalysis/before11Aggregate'
import { buildConfigScope } from '../vendorAnalysis/supplierScope'
import { loadPriorityClientCodes } from '../priorityClients'
import {
  isNoSortingBatch,
  sortingWorkdayCatchUpDates,
} from '../imile/sortingWorkday'
import { resolveMinSortingWaybills } from '../dispatch24hStats/configRepository'
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

export type ExitAlarmPushResult = {
  pushedCount: number
  totalConfigs: number
  errors: string[]
  stationCode: string
  /** 本次统计的到件日列表（可多日合并） */
  dates: string[]
  /** 到件量低于 MIN_SORTING_WAYBILLS：这天没开仓分拣，没有批次可推 */
  noBatch?: boolean
  /** 各供应商本次推送中未在阈值前出仓（未达标）的运单号，供前端导出 Excel */
  unqualifiedByVendor: {
    vendorName: string
    waybillNos: string[]
    /** 路由码白名单范围内未达标的运单号；不受「路由码白名单数据推送」开关影响，导出始终带上 */
    whitelistWaybillNos: string[]
  }[]
}

/**
 * 出仓告警核心：拉到件索引运单 → 按供应商 routeCode/白名单过滤 → 建卡推送。
 * 供定时任务与「立刻推送」复用；不校验 weekdays / pushTimes。
 */
export async function executeExitAlarmPush(params: {
  token: string
  stationCode: string
  /** 到件日（查询目标）YYYY-MM-DD，可多日；跨周末/节假日时会回退到最近工作日，可能早于「今天」多天。多日按运单号去重后合并统计 */
  dates: string[]
  /** 推送实际触发那天 YYYY-MM-DD（账号州时区）——阈值锚点，与 date 是两回事，不能互相替代 */
  todayDateStr: string
  pushTime: string
  configs: FleetSupplierPushConfig[]
  tz: AusTz
  label: string
  /** 是否 @ 供应商配置花名册第 1 位联系人；默认 false */
  mentionEnabled?: boolean
  /** 是否在主卡片推送成功后额外推送第二条「路由码白名单出仓数据」卡片；默认 false */
  routeCodeWhitelistPushEnabled?: boolean
  /** 滞留清货价：每件清货补贴（美元）；传入时卡片展示「未出仓件数 × 单价」的清货费用 */
  clearancePrice?: number | null
  /** 重要提醒：填了就原样追加在卡片末尾，@ 人拼在它后面 */
  importantNotice?: string | null
  /**
   * 仅供定时任务传入：按 (jobKeyPrefix:configId, slotKey) 对每个供应商配置单独做幂等去重。
   * 某个配置本次已经成功推送过则跳过，推送失败/暂无数据则释放，交给下次 catch-up 重试；
   * 「立刻推送」不传此参数，始终对全部 configs 重新执行，不受定时任务的去重状态影响。
   */
  perConfigDedupe?: { jobKeyPrefix: string; slotKey: string }
}): Promise<ExitAlarmPushResult | { error: string }> {
  const {
    token,
    stationCode,
    dates,
    todayDateStr,
    pushTime,
    configs,
    tz,
    label,
    mentionEnabled,
    routeCodeWhitelistPushEnabled,
    clearancePrice,
    importantNotice,
    perConfigDedupe,
  } = params

  if (dates.length === 0) return { error: '未指定到件扫描日期' }

  // 多到件日：逐日拉数后按运单号去重合并（同一单可能在多天的到件索引里出现），后续统计口径不变
  const byWaybillNo = new Map<string, Record<string, unknown>>()
  for (const dateStr of dates) {
    const result = await fetchExitAlarmWaybillRecords({ token, stationCode, dateStr, label })
    if (!result.ok) {
      console.error(`${label} 到件日 ${dateStr} 运单查询失败: ${result.message}`)
      return { error: `到件日 ${dateStr} 运单查询失败: ${result.message}` }
    }
    for (const record of result.records) {
      const no = typeof record.waybillNo === 'string' ? record.waybillNo.trim() : ''
      byWaybillNo.set(no || `__idx_${byWaybillNo.size}`, record)
    }
  }

  const waybills = [...byWaybillNo.values()]

  // 这天没开仓分拣：值班员工零星扫入库的几十单不构成批次，推出去的滞留数据没有意义，
  // 也不是供应商的责任。不 claim 时间槽（本来就没什么可推），日志留量便于核对阈值。
  // 阈值按站点覆盖（见 dispatch24hStats/configRepository.ts resolveMinSortingWaybills）：
  // 全局阈值是照大站点定的，小站点正常营业量可能常年卡在阈值以下，需要各站点自己的数。
  const minSortingWaybills = await resolveMinSortingWaybills(stationCode)
  if (isNoSortingBatch(waybills.length, minSortingWaybills)) {
    console.log(
      `${label} 到件日 ${dates.join(',')} 仅 ${waybills.length} 单（< ${minSortingWaybills}），` +
        '判定当天未开仓分拣，跳过推送',
    )
    return {
      pushedCount: 0,
      totalConfigs: configs.length,
      errors: [],
      stationCode,
      dates,
      noBatch: true,
      unqualifiedByVendor: [],
    }
  }

  // 阈值锚在「推送实际触发那天」的「推送触发时刻」——不能用 date（到件日）反推次日，
  // 到件日跨周末/节假日回退后可能是好几天前，「到件日+1天」不等于「今天」（例：周一到件日
  // 回退到上周五，+1 天=周六，早已过去，会把当天所有正常出仓都误判成「未出仓」）。
  // 也不再固定 11:00 —— 与「供应商数据分析」的 before11ExitRate（固定 11 点口径）区分开。
  const before11ThresholdMs = computeThresholdMsOnDate(todayDateStr, tz, pushTime)
  // 取数层：全量打标；过滤留给各配置业务侧（与供应商分析对称）
  const taggedRows = tagBefore11Rows({
    rows: waybills as Array<Record<string, unknown>>,
    before11ThresholdMs,
  })
  let pushedCount = 0
  const errors: string[] = []
  const unqualifiedByVendor: ExitAlarmPushResult['unqualifiedByVendor'] = []

  // 与「供应商数据分析」同一套归属口径：courierVendorCode 归属 → routeCode 纳入 → 白名单剔除。
  // 用 config.id 当 key 一次遍历 taggedRows 拿到全部配置的统计，不再对每条配置各自重新扫一遍全量到件运单。
  // 未选供应商的配置（vendorCode 为空）走纯路由码口径，由 buildConfigScope 统一判定
  const scopes: Before11Scope[] = configs.map((config) => buildConfigScope(config.id, config))
  // 「本地件优先客户」名单来自「优先客户配置」页面，每次推送读一次即可（配置量小）
  const priorityClientCodes = await loadPriorityClientCodes()
  // 路由归属优先：代清货/借调司机跑了这条路由，也算到路由配置所属的供应商头上，
  // 不因承运商不是自己就把这条路由底下的滞留量漏统计（见 supplierScope.resolveConfigScopesForRowByRoutePriority）
  const statsByConfigId = aggregateBefore11ByScopes({ rows: taggedRows, scopes, priorityClientCodes, routePriority: true })

  for (const config of configs) {
    const vendorName = supplierDisplayName(config)
    const stat = statsByConfigId.get(config.id) ?? {
      totalWaybills: 0,
      zoneBreakdown: {},
      unqualifiedWaybillNos: [],
    }
    const totalPending = Object.values(stat.zoneBreakdown).reduce((s, v) => s + v.pending, 0)

    // 导出用明细与是否推送无关：无滞留时也记一条空明细，前端「立刻推送」导出的供应商列表保持完整
    unqualifiedByVendor.push({
      vendorName,
      waybillNos: stat.unqualifiedWaybillNos,
      whitelistWaybillNos: stat.whitelistStat?.unqualifiedWaybillNos ?? [],
    })

    // 无滞留数据不推送；不 claim，留给下次重新判断
    if (totalPending === 0) {
      console.log(`${label} ${vendorName} 无滞留数据，跳过推送`)
      continue
    }

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
      const mentions = pickMentions(parseSupplierMentionContacts(config.mentionOpenIds), Boolean(mentionEnabled))
      const noticeText = (importantNotice ?? '').trim()
      // 路由码白名单数据不再作为独立第二条消息推送，而是作为折叠面板追加在主卡片末尾，默认折叠。
      const whitelistStat =
        routeCodeWhitelistPushEnabled && stat.whitelistStat && stat.whitelistStat.totalWaybills > 0
          ? stat.whitelistStat
          : null
      const card = buildExitAlarmCard({
        vendorName,
        date: todayDateStr,
        pushTime,
        tz,
        zoneBreakdown: stat.zoneBreakdown,
        totalPending,
        totalWaybills: stat.totalWaybills,
        pushDescription: config.pushDescription,
        // 填了重要提醒时 @ 人挪到提醒那条消息里，数据卡片不再 @
        mentions: noticeText ? [] : mentions,
        whitelistStat,
        whitelistZoneBreakdown: stat.whitelistStat?.zoneBreakdown,
        clearancePrice,
      })

      const { ok, reason, messageId, chatId } = await sendSupplierPushCard(config, card)
      if (!ok) {
        const detail = reason ? ` (${reason})` : ''
        console.error(`${label} ✗ 推送失败: ${vendorName}${detail}`)
        errors.push(`${vendorName}: ${reason ?? '推送失败'}`)
        if (dedupeJobKey) await releaseScheduledSlot(dedupeJobKey, perConfigDedupe!.slotKey)
        continue
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

      void recordFeishuPushMessage({ supplierConfigId: config.id, chatId, messageId, pushLabel: '滞留数据告警' })
      pushedCount++
      console.log(`${label} ✓ 推送成功: ${vendorName}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${label} ✗ 处理异常: ${vendorName} (${msg})`)
      errors.push(`${vendorName}: 处理异常(${msg})`)
      if (dedupeJobKey) await releaseScheduledSlot(dedupeJobKey, perConfigDedupe!.slotKey)
    }
  }

  return { pushedCount, totalConfigs: configs.length, errors, stationCode, dates, unqualifiedByVendor }
}

/** 处理单个账号的定时配置：命中推送时间则读取到件索引并执行告警推送 */
async function runOneScheduledPush(schedule: ExitAlarmSchedule, regionCode: string | null): Promise<void> {
  const label = `[exit-alarm/scheduler user=${schedule.userId}]`

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
    const { weekday, timeHHmm, dateStr: todayDateStr, prevDateStr } = slot
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

    // 目标日避开周末（周六/日不分拣、无数据）：从前一日往前取第一个工作日，中间跳过的周末日
    // 一并带上（见 sortingWorkdayCatchUpDates）——没开仓就是没数据，真开仓时不漏算。
    // 周六/周日推送照样落在周五那批：阈值锚在「今天的推送时刻」（见下方 before11ThresholdMs），
    // 推的是「截至此刻还剩多少没出仓」的进度，与那批考核终值在下周一 11:00 并不冲突 ——
    // 很多仓库周六早上照常开仓取货，就是要看这条。这天没开仓分拣的情形由量判定接手（见 execute）。
    const targetDates = sortingWorkdayCatchUpDates(prevDateStr)
    console.log(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm} dates=${targetDates.join(',')}`)

    const result = await executeExitAlarmPush({
      token: rawToken,
      stationCode,
      dates: targetDates,
      todayDateStr,
      pushTime: timeHHmm,
      configs,
      tz,
      label,
      mentionEnabled: schedule.mentionEnabled,
      routeCodeWhitelistPushEnabled: schedule.routeCodeWhitelistPushEnabled,
      clearancePrice: schedule.clearancePrice,
      importantNotice: schedule.importantNotice,
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
