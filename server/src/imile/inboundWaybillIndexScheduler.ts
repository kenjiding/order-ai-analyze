/**
 * 到件 waybillNo 索引：独立定时预取（每日 06:00 阿德莱德，抓昨天 inbound/query）。
 */

import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import {
  fetchInboundWaybillNos,
  getRegionNow,
  INBOUND_INDEX_ADELAIDE_TZ,
  INBOUND_INDEX_RETENTION_DAYS,
  loadInboundWaybillIndex,
  purgeOldInboundWaybillIndex,
  saveInboundWaybillIndex,
} from './inboundWaybillIndex'
import { resolveRegionTz } from './ausTimezone'
import { envFirst, normalizeImileToken, readDefaultImileHubcode } from './shared'

const LABEL = '[inbound-index/scheduler]'

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
      `${LABEL} 就绪 cron="0 6 * * *" tz=${INBOUND_INDEX_ADELAIDE_TZ} retention=${INBOUND_INDEX_RETENTION_DAYS}d stations=[${stations.join(',')}] token=${token ? 'ok' : 'missing'}`,
    )
    if (!token) {
      console.warn(`${LABEL} 缺少 iMile token，请设置 IMILE_INBOUND_INDEX_TOKEN 或 IMILE_EXIT_ALARM_TOKEN`)
    }
  } catch (err) {
    console.error(`${LABEL} 启动自检失败:`, err)
  }
}

/** 每日由 scheduler 调用：遍历所有已启用配置各自的（站点, 当地昨日）组合去重后抓取 inbound/query 并写入索引，再清理过期数据 */
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

  // (stationCode, dateStr) 去重：多个账号可能共享同一站点/同一当地日期。
  // 环境变量指定的站点及无匹配账号时的默认站点，按系统默认时区（阿德莱德）兜底。
  const targets = new Map<string, { stationCode: string; dateStr: string }>()
  const defaultDateStr = getRegionNow().prevDateStr
  for (const stationCode of envStationCodes) {
    targets.set(`${stationCode}|${defaultDateStr}`, { stationCode, dateStr: defaultDateStr })
  }
  for (const row of rows) {
    const stationCode = row.stationCode?.trim()
    if (!stationCode) continue
    const { prevDateStr } = getRegionNow(resolveRegionTz(row.regionCode))
    targets.set(`${stationCode}|${prevDateStr}`, { stationCode, dateStr: prevDateStr })
  }
  if (targets.size === 0) {
    targets.set(`${readDefaultImileHubcode()}|${defaultDateStr}`, {
      stationCode: readDefaultImileHubcode(),
      dateStr: defaultDateStr,
    })
  }

  console.log(`${LABEL} 开始预取 targets=[${[...targets.values()].map((t) => `${t.stationCode}@${t.dateStr}`).join(',')}]`)

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

  const purged = await purgeOldInboundWaybillIndex(INBOUND_INDEX_RETENTION_DAYS)
  if (purged > 0) {
    console.log(`${LABEL} 已清理 ${purged} 条过期索引（保留 ${INBOUND_INDEX_RETENTION_DAYS} 天）`)
  }

  console.log(`${LABEL} 预取完成`)
}
