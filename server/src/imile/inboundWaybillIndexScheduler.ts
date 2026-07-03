/**
 * 到件 waybillNo 索引：独立定时预取（每日 06:00 阿德莱德触发）。
 * 分两波：昨天（强制覆盖，供 11 点前出仓率等使用）→ 错峰 → 前天（缺失才拉取，供 24 小时派签率使用）。
 */

import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import {
  fetchInboundWaybillNos,
  getOrFetchInboundWaybillNos,
  getRegionNow,
  INBOUND_INDEX_ADELAIDE_TZ,
  INBOUND_INDEX_RETENTION_DAYS,
  loadInboundWaybillIndex,
  purgeOldInboundWaybillIndex,
  saveInboundWaybillIndex,
} from './inboundWaybillIndex'
import { resolveRegionTz, type AusTz } from './ausTimezone'
import { envFirst, normalizeImileToken, readDefaultImileHubcode, sleep } from './shared'

const LABEL = '[inbound-index/scheduler]'
/** 前天波次与昨天波次错峰的间隔：避免两波预取撞在同一时刻把 imile 请求量翻倍 */
const DAY_BEFORE_WAVE_DELAY_MS = 5 * 60_000

type EnabledScheduleRow = {
  stationCode: string
  imileToken: string | null
  regionCode: string | null
}

/** 已启用的出仓告警配置（按账号隔离），附带各自拥有者的 regionCode */
async function listEnabledScheduleRows(): Promise<EnabledScheduleRow[]> {
  try {
    const db = getDb()
    return await db
      .select({
        stationCode: schema.exitAlarmSchedules.stationCode,
        imileToken: schema.exitAlarmSchedules.imileToken,
        regionCode: schema.users.regionId,
      })
      .from(schema.exitAlarmSchedules)
      .leftJoin(schema.users, eq(schema.exitAlarmSchedules.userId, schema.users.id))
      .where(eq(schema.exitAlarmSchedules.isEnabled, true))
  } catch {
    // worker 启动自检时 DB 可能尚未就绪，忽略
    return []
  }
}

export async function readInboundIndexImileToken(): Promise<string> {
  const fromEnv = envFirst('IMILE_INBOUND_INDEX_TOKEN', 'IMILE_EXIT_ALARM_TOKEN')
  if (fromEnv) return normalizeImileToken(fromEnv)

  const rows = await listEnabledScheduleRows()
  const fromSchedule = rows.map((r) => r.imileToken?.trim()).find((t) => !!t)
  return fromSchedule ? normalizeImileToken(fromSchedule) : ''
}

/** 预取站点：环境变量 ∪ 所有已启用的出仓告警配置 ∪ 系统默认 hubcode */
export async function resolveInboundIndexStationCodes(): Promise<string[]> {
  const fromEnv = (envFirst('INBOUND_INDEX_STATION_CODES') ?? '')
    .split(/[\s,，]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const codes = new Set<string>(fromEnv)

  const rows = await listEnabledScheduleRows()
  for (const row of rows) {
    const code = row.stationCode?.trim()
    if (code) codes.add(code)
  }

  if (codes.size === 0) {
    codes.add(readDefaultImileHubcode())
  }

  return [...codes]
}

export async function logInboundIndexSchedulerReadiness(): Promise<void> {
  try {
    const stations = await resolveInboundIndexStationCodes()
    const token = await readInboundIndexImileToken()
    console.log(
      `${LABEL} 就绪 cron="0 6 * * *" tz=${INBOUND_INDEX_ADELAIDE_TZ} retention=${INBOUND_INDEX_RETENTION_DAYS}d stations=[${stations.join(',')}] token=${token ? 'ok' : 'missing'}（昨天全量覆盖 + 错峰${DAY_BEFORE_WAVE_DELAY_MS / 60_000}分钟后前天缺失补拉，供24H派签率使用）`,
    )
    if (!token) {
      console.warn(`${LABEL} 缺少 iMile token，请设置 IMILE_INBOUND_INDEX_TOKEN 或 IMILE_EXIT_ALARM_TOKEN`)
    }
  } catch (err) {
    console.error(`${LABEL} 启动自检失败:`, err)
  }
}

type IndexTarget = { stationCode: string; dateStr: string }

/**
 * (stationCode, dateStr) 去重：多个账号可能共享同一站点/同一当地日期。
 * 环境变量指定的站点及无匹配账号时的默认站点，按系统默认时区（阿德莱德）兜底。
 */
function buildIndexTargets(
  rows: EnabledScheduleRow[],
  envStationCodes: string[],
  defaultDateStr: string,
  pickDateStr: (regionTz: AusTz) => string,
): Map<string, IndexTarget> {
  const targets = new Map<string, IndexTarget>()
  for (const stationCode of envStationCodes) {
    targets.set(`${stationCode}|${defaultDateStr}`, { stationCode, dateStr: defaultDateStr })
  }
  for (const row of rows) {
    const stationCode = row.stationCode?.trim()
    if (!stationCode) continue
    const dateStr = pickDateStr(resolveRegionTz(row.regionCode))
    targets.set(`${stationCode}|${dateStr}`, { stationCode, dateStr })
  }
  if (targets.size === 0) {
    targets.set(`${readDefaultImileHubcode()}|${defaultDateStr}`, {
      stationCode: readDefaultImileHubcode(),
      dateStr: defaultDateStr,
    })
  }
  return targets
}

/** 昨天波次：11 点前出仓率等既有场景依赖，每日强制覆盖重拉，保证拿到当天最终数据 */
async function prefetchYesterdayWave(token: string, targets: Map<string, IndexTarget>): Promise<void> {
  console.log(`${LABEL} 开始预取(昨天) targets=[${[...targets.values()].map((t) => `${t.stationCode}@${t.dateStr}`).join(',')}]`)

  for (const { stationCode, dateStr } of targets.values()) {
    const existing = await loadInboundWaybillIndex(stationCode, dateStr)
    if (existing) {
      console.log(`${LABEL} 已有索引 station=${stationCode} date=${dateStr} count=${existing.length}，重新拉取覆盖`)
    }

    const inbound = await fetchInboundWaybillNos({
      token,
      stationCode,
      dateStr,
      label: `${LABEL} inbound/query`,
    })
    if (!inbound.ok) {
      console.error(`${LABEL} 预取失败 station=${stationCode} date=${dateStr}: ${inbound.message}`)
      continue
    }

    await saveInboundWaybillIndex({
      stationCode,
      dataDate: dateStr,
      waybillNos: inbound.waybillNos,
    })
    console.log(`${LABEL} ✓ station=${stationCode} date=${dateStr} count=${inbound.waybillNos.length}`)
  }
}

/**
 * 前天波次：24 小时派签率依赖。前天数据通常已被「昨天前一天跑的」波次覆盖，
 * 因此这里缺失才拉取（而非强制覆盖），既满足「已有就不重复获取」，也天然降低对 imile 的请求量。
 */
async function prefetchDayBeforeWaveIfMissing(token: string, targets: Map<string, IndexTarget>): Promise<void> {
  console.log(`${LABEL} 开始预取(前天，缺失才拉取) targets=[${[...targets.values()].map((t) => `${t.stationCode}@${t.dateStr}`).join(',')}]`)

  for (const { stationCode, dateStr } of targets.values()) {
    const result = await getOrFetchInboundWaybillNos({ token, stationCode, dateStr, label: LABEL })
    if (!result.ok) {
      console.error(`${LABEL} 预取失败 station=${stationCode} date=${dateStr}: ${result.message}`)
      continue
    }
    console.log(
      `${LABEL} ✓ station=${stationCode} date=${dateStr} count=${result.waybillNos.length} source=${result.fromCache ? 'cache' : 'inbound/query'}`,
    )
  }
}

/** 每日由 scheduler 调用：先补齐昨天索引（强制覆盖），错峰后再补齐前天索引（缺失才拉取），最后清理过期数据 */
export async function runDailyInboundWaybillIndexPrefetch(): Promise<void> {
  const token = await readInboundIndexImileToken()
  if (!token) {
    console.warn(`${LABEL} 缺少 iMile token，跳过预取`)
    return
  }

  const rows = await listEnabledScheduleRows()
  const envStationCodes = (envFirst('INBOUND_INDEX_STATION_CODES') ?? '')
    .split(/[\s,，]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const regionNow = getRegionNow()

  const yesterdayTargets = buildIndexTargets(
    rows,
    envStationCodes,
    regionNow.prevDateStr,
    (tz) => getRegionNow(tz).prevDateStr,
  )
  await prefetchYesterdayWave(token, yesterdayTargets)

  // 与前天波次错峰，避免同一时刻两倍请求量导致 imile 繁忙
  await sleep(DAY_BEFORE_WAVE_DELAY_MS)

  const dayBeforeTargets = buildIndexTargets(
    rows,
    envStationCodes,
    regionNow.dayBeforeDateStr,
    (tz) => getRegionNow(tz).dayBeforeDateStr,
  )
  await prefetchDayBeforeWaveIfMissing(token, dayBeforeTargets)

  const purged = await purgeOldInboundWaybillIndex(INBOUND_INDEX_RETENTION_DAYS)
  if (purged > 0) {
    console.log(`${LABEL} 已清理 ${purged} 条过期索引（保留 ${INBOUND_INDEX_RETENTION_DAYS} 天）`)
  }

  console.log(`${LABEL} 预取完成`)
}
