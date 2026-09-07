import crypto from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { Dispatch24hDriverStat } from '../vendorAnalysis/dispatch24hAggregate'
import { buildDispatchAlarmShareUrl } from './publicWebOrigin'

/** 派签告警分享快照保留天数（读时校验 + 定时/顺带清理一致） */
export const DISPATCH_ALARM_SHARE_RETENTION_DAYS = 1
export const DISPATCH_ALARM_SHARE_TTL_MS = DISPATCH_ALARM_SHARE_RETENTION_DAYS * 24 * 60 * 60 * 1000

export type DispatchAlarmSharePayload = {
  vendorCode: string
  /**
   * 推送当时这条供应商配置的路由码纳入名单（空 = 不按路由码收窄）。
   * 同一 vendorCode 可能有多条配置（ADL-City / ADL-Lu），落地页的司机地图必须靠它再收窄一次，
   * 否则会把同编码另一家的单也画进来、派送单量也跟着多算。
   */
  routeCodes: string[]
  /** 推送当时这条供应商配置的路由码白名单（命中则剔除） */
  routeCodeWhitelist: string[]
  vendorName: string
  stationCode: string
  date: string
  pushTime: string
  total: number
  met: number
  /** 问题件数：见 aggregateDispatch24hByVendor 的 isDispatch24hProblem 口径 */
  problemCount: number
  alertThresholdPct: number
  drivers: Dispatch24hDriverStat[]
  /** 未分配司机（尚未派件）的那部分单，见 Dispatch24hVendorStat.unassigned */
  unassigned: Dispatch24hDriverStat | null
  /** 是否在落地页展示「司机地图」组件 */
  showDriverMap: boolean
  /**
   * 本次推送真正统计的到件日 YYYY-MM-DD 列表。
   * 不能拿 date 顶替：date 是展示用标签，多到件日时是拼接串（如 2026-09-04 ～ 2026-09-05），
   * 司机地图按它查库会一条都查不到。
   */
  dataDates: string[]
}

function newShareToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** 删除超过保留期的派签告警分享快照（按 createdAt） */
export async function purgeOldDispatchAlarmShareSnapshots(
  keepDays = DISPATCH_ALARM_SHARE_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)
  const db = getDb()
  const deleted = await db
    .delete(schema.dispatchAlarmShareSnapshots)
    .where(lt(schema.dispatchAlarmShareSnapshots.createdAt, cutoff))
    .returning({ id: schema.dispatchAlarmShareSnapshots.id })
  return deleted.length
}

/** 推送时落库快照并返回可打开的落地页 URL；失败返回 null（推送仍可继续，仅无链接） */
export async function createDispatchAlarmShareSnapshot(params: {
  vendorCode: string
  routeCodes: string[]
  routeCodeWhitelist: string[]
  vendorName: string
  stationCode: string
  date: string
  pushTime: string
  total: number
  met: number
  problemCount: number
  alertThresholdPct: number
  drivers: Dispatch24hDriverStat[]
  unassigned: Dispatch24hDriverStat | null
  showDriverMap: boolean
  dataDates: string[]
}): Promise<{ token: string; url: string } | null> {
  const {
    vendorCode,
    routeCodes,
    routeCodeWhitelist,
    vendorName,
    stationCode,
    date,
    pushTime,
    total,
    met,
    problemCount,
    alertThresholdPct,
    drivers,
    unassigned,
    showDriverMap,
    dataDates,
  } = params
  const urlProbe = buildDispatchAlarmShareUrl('probe')
  if (!urlProbe) {
    console.warn('[dispatch-alarm/share] PUBLIC_WEB_ORIGIN / CORS_ORIGIN 未配置，跳过落地页链接')
    return null
  }

  const token = newShareToken()
  const payload: DispatchAlarmSharePayload = {
    vendorCode,
    routeCodes,
    routeCodeWhitelist,
    vendorName,
    stationCode,
    date,
    pushTime,
    total,
    met,
    problemCount,
    alertThresholdPct,
    drivers,
    unassigned,
    showDriverMap,
    dataDates,
  }

  try {
    const db = getDb()
    await db.insert(schema.dispatchAlarmShareSnapshots).values({
      token,
      vendorCode,
      vendorName,
      stationCode,
      date,
      pushTime,
      payload,
    })
  } catch (err) {
    console.error('[dispatch-alarm/share] 落库失败:', err)
    return null
  }

  // 顺带清理过期行，避免只依赖日调度
  void purgeOldDispatchAlarmShareSnapshots().catch((err) => {
    console.error('[dispatch-alarm/share] 清理过期快照失败:', err)
  })

  const url = buildDispatchAlarmShareUrl(token)
  if (!url) return null
  return { token, url }
}

export type DispatchAlarmShareView = DispatchAlarmSharePayload & {
  createdAt: string
}

/** 凭 token 读取快照；过期或不存在返回 null（调用方统一 404） */
export async function loadDispatchAlarmShareSnapshot(
  token: string,
): Promise<DispatchAlarmShareView | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(schema.dispatchAlarmShareSnapshots)
    .where(eq(schema.dispatchAlarmShareSnapshots.token, token))
    .limit(1)
  const row = rows[0]
  if (!row) return null

  const age = Date.now() - new Date(row.createdAt).getTime()
  if (age > DISPATCH_ALARM_SHARE_TTL_MS) return null

  const payload = row.payload as DispatchAlarmSharePayload
  if (!payload || typeof payload !== 'object') return null

  // 异步更新访问时间，不阻塞响应
  void db
    .update(schema.dispatchAlarmShareSnapshots)
    .set({ lastAccessedAt: new Date() })
    .where(eq(schema.dispatchAlarmShareSnapshots.id, row.id))
    .catch(() => undefined)

  return {
    vendorCode: String(payload.vendorCode ?? row.vendorCode),
    routeCodes: Array.isArray(payload.routeCodes) ? payload.routeCodes.map(String) : [],
    routeCodeWhitelist: Array.isArray(payload.routeCodeWhitelist)
      ? payload.routeCodeWhitelist.map(String)
      : [],
    vendorName: String(payload.vendorName ?? row.vendorName),
    stationCode: String(payload.stationCode ?? row.stationCode),
    date: String(payload.date ?? row.date),
    pushTime: String(payload.pushTime ?? row.pushTime),
    total: typeof payload.total === 'number' ? payload.total : 0,
    met: typeof payload.met === 'number' ? payload.met : 0,
    problemCount: typeof payload.problemCount === 'number' ? payload.problemCount : 0,
    alertThresholdPct: typeof payload.alertThresholdPct === 'number' ? payload.alertThresholdPct : 0,
    drivers: Array.isArray(payload.drivers) ? payload.drivers : [],
    unassigned: payload.unassigned ?? null,
    showDriverMap: payload.showDriverMap === true,
    dataDates: Array.isArray(payload.dataDates) ? payload.dataDates.map(String) : [],
    createdAt: new Date(row.createdAt).toISOString(),
  }
}
