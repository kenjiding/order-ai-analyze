import { asc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { ExitAlarmSchedule } from '../db/schema'
import { buildExitAlarmCard } from './buildExitAlarmCard'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { envFirst, envFirstOr, normalizeImileToken } from '../imile/shared'
import { buildImilePortalHeaders, IMILE_DS_SAAS_TMS_PORTAL } from '../imile/portal'
import { requestImileApi } from '../imile/client'
import { fetchPaginatedResultRows } from '../imile/paginatedQuery'

const ADELAIDE_TZ = 'Australia/Adelaide'
const MELBOURNE_TZ = 'Australia/Melbourne'
const DEFAULT_DS_WAYBILL_URL = 'https://ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'

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
      `${label} 就绪 weekdays=[${weekdays.join(',')}] times=[${pushTimes.map((s) => s.time).join(',')}] station=${schedule.stationCode}`,
    )
  } catch (err) {
    console.error(`${label} 启动自检失败:`, err)
  }
}

// ─── 时区工具 ─────────────────────────────────────────────────────────────────

function tzOffsetMs(utcDate: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(utcDate)
  const g = (t: string) => {
    const v = parseInt(parts.find((p) => p.type === t)?.value ?? '0')
    return t === 'hour' && v === 24 ? 0 : v
  }
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcDate.getTime()
}

function localToUtcMs(str: string, tz: string): number {
  const [datePart, timePart = '00:00:00'] = str.split(' ')
  const [yr, mo, dy] = datePart.split('-').map(Number)
  const [h = 0, m = 0, s = 0] = timePart.split(':').map(Number)
  const probe = Date.UTC(yr, mo - 1, dy, h, m, s)
  return probe - tzOffsetMs(new Date(probe), tz)
}

function utcMsToLocalStr(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms))
  const g = (t: string) => (parts.find((p) => p.type === t)?.value ?? '00')
  const hour = g('hour') === '24' ? '00' : g('hour')
  return `${g('year')}-${g('month')}-${g('day')} ${hour}:${g('minute')}:${g('second')}`
}

/** 获取当前阿德莱德时间信息 */
function getAdelaideNow(): {
  weekday: number   // 1=周一…7=周日
  timeHHmm: string  // "HH:mm"
  dateStr: string   // "YYYY-MM-DD" (今天)
  prevDateStr: string // "YYYY-MM-DD" (昨天)
} {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ADELAIDE_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(now)
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''

  const weekdayShort = g('weekday') // "Mon", "Tue", ...
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  }
  const weekday = weekdayMap[weekdayShort] ?? 1

  const dateStr = `${g('year')}-${g('month')}-${g('day')}`
  const hour = g('hour') === '24' ? '00' : g('hour')
  const timeHHmm = `${hour}:${g('minute')}`

  // 昨天日期：取今天 Adelaide 00:00 的 UTC ms - 1 分钟，再格式化
  const todayStartMs = localToUtcMs(`${dateStr} 00:00:00`, ADELAIDE_TZ)
  const prevDateStr = utcMsToLocalStr(todayStartMs - 60_000, ADELAIDE_TZ).slice(0, 10)

  return { weekday, timeHHmm, dateStr, prevDateStr }
}

// ─── 推送逻辑（与 exitAlarmRouter push-now 相同的核心） ───────────────────────

function makeWaybillHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_VENDOR_DS_WAYBILL',
    defaults: IMILE_DS_SAAS_TMS_PORTAL,
    sharedEnvPrefixes: ['IMILE_VENDOR_LONG_TAIL', 'IMILE_CANCEL_SCAN', 'IMILE_TRACK'],
  })
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

/** 每分钟由 scheduler 调用；检查当前 Adelaide 时间是否命中配置并执行推送 */
export async function runExitAlarmScheduledPush(): Promise<void> {
  const label = '[exit-alarm/scheduler]'

  // 1. 读取推送计划
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

  // 2. 检查当前 Adelaide 时间是否命中配置
  const { weekday, timeHHmm, prevDateStr } = getAdelaideNow()
  const weekdays = schedule.weekdays as number[]
  if (!weekdays.includes(weekday)) return

  const pushTimes = schedule.pushTimes as Array<{ id: string; time: string }>
  const matchedSlot = pushTimes.find((s) => s.time === timeHHmm)
  if (!matchedSlot) return

  const rawToken = readExitAlarmImileToken(schedule)
  if (!rawToken) {
    console.warn(
      `${label} 命中推送时间 weekday=${weekday} time=${timeHHmm}，但缺少 iMile token，无法拉数推送`,
    )
    return
  }

  console.log(`${label} 命中推送时间 weekday=${weekday} time=${timeHHmm} date=${prevDateStr}`)

  // 3. 获取已启用的供应商推送配置
  const configs = await db
    .select()
    .from(schema.exitAlarmPushConfigs)
    .where(eq(schema.exitAlarmPushConfigs.isDisabled, false))
    .orderBy(asc(schema.exitAlarmPushConfigs.createdAt))

  if (configs.length === 0) {
    console.log(`${label} 无已启用的供应商推送配置，跳过`)
    return
  }

  // 4. 拉取运单（前一日 00:00:00–23:59:59 Adelaide → Melbourne 时间字符串）
  const startTime = utcMsToLocalStr(localToUtcMs(`${prevDateStr} 00:00:00`, ADELAIDE_TZ), MELBOURNE_TZ)
  const endTime = utcMsToLocalStr(localToUtcMs(`${prevDateStr} 23:59:59`, ADELAIDE_TZ), MELBOURNE_TZ)

  const normalizedToken = normalizeImileToken(rawToken)
  const url = envFirstOr(['IMILE_VENDOR_DS_WAYBILL_URL'], DEFAULT_DS_WAYBILL_URL)
  const headers = makeWaybillHeaders(normalizedToken)

  const result = await fetchPaginatedResultRows({
    label: '出仓告警定时推送',
    pageShowCount: 1000,
    pageDelayMs: 300,
    buildPageBody: ({ currentPage, showCount }) => ({
      actualReceiveStation: '',
      currentPage,
      dateSearchType: 'firstCountry',
      startTime,
      endTime,
      lastScanStationCode: stationCode,
      labelOrderCodes: [] as string[],
      mainWaybillNos: [] as string[],
      platformNos: [] as string[],
      referenceNos: [] as string[],
      showCount,
      waybillNos: [] as string[],
    }),
    requestPage: (pageBody) =>
      requestImileApi({ url, method: 'POST', headers, body: pageBody, label: '出仓告警定时推送' }),
  })

  if (!result.ok) {
    console.error(`${label} 运单查询失败: ${result.message}`)
    return
  }

  type WaybillRow = { deliveryTime?: string | null; consigneeRouteCode?: string | null; [k: string]: unknown }
  const waybills = result.records as WaybillRow[]

  // 5. 逐供应商统计并推送
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
