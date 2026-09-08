import crypto from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { VendorStagnationSummary } from '../imile/chaseDispatchAggregate'
import { buildChaseDispatchShareUrl } from './publicWebOrigin'

/** 催派分享快照保留天数（读时校验 + 定时/顺带清理一致） */
export const CHASE_DISPATCH_SHARE_RETENTION_DAYS = 1
export const CHASE_DISPATCH_SHARE_TTL_MS = CHASE_DISPATCH_SHARE_RETENTION_DAYS * 24 * 60 * 60 * 1000

export type ChaseDispatchSharePayload = {
  vendorCode: string
  vendorName: string
  baseDate: string
  pushTime: string
  totalStagnant: number
  /** 「本地件优先客户」滞留件数；旧快照可能没有该字段 */
  priorityTotal?: number
  buckets: VendorStagnationSummary['buckets']
}

function newShareToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** 删除超过保留期的催派分享快照（按 createdAt） */
export async function purgeOldChaseDispatchShareSnapshots(
  keepDays = CHASE_DISPATCH_SHARE_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)
  const db = getDb()
  const deleted = await db
    .delete(schema.chaseDispatchShareSnapshots)
    .where(lt(schema.chaseDispatchShareSnapshots.createdAt, cutoff))
    .returning({ id: schema.chaseDispatchShareSnapshots.id })
  return deleted.length
}

/** 推送时落库快照并返回可打开的落地页 URL；失败返回 null（推送仍可继续，仅无链接） */
export async function createChaseDispatchShareSnapshot(params: {
  vendorCode: string
  vendorName: string
  baseDate: string
  pushTime: string
  summary: VendorStagnationSummary
}): Promise<{ token: string; url: string } | null> {
  const { vendorCode, vendorName, baseDate, pushTime, summary } = params
  const urlProbe = buildChaseDispatchShareUrl('probe')
  if (!urlProbe) {
    console.warn('[chase-dispatch/share] PUBLIC_WEB_ORIGIN / CORS_ORIGIN 未配置，跳过落地页链接')
    return null
  }

  const token = newShareToken()
  const payload: ChaseDispatchSharePayload = {
    vendorCode,
    vendorName,
    baseDate,
    pushTime,
    totalStagnant: summary.totalStagnant,
    priorityTotal: summary.priorityTotal,
    buckets: summary.buckets,
  }

  try {
    const db = getDb()
    await db.insert(schema.chaseDispatchShareSnapshots).values({
      token,
      vendorCode,
      vendorName,
      baseDate,
      pushTime,
      payload,
    })
  } catch (err) {
    console.error('[chase-dispatch/share] 落库失败:', err)
    return null
  }

  // 顺带清理过期行，避免只依赖日调度
  void purgeOldChaseDispatchShareSnapshots().catch((err) => {
    console.error('[chase-dispatch/share] 清理过期快照失败:', err)
  })

  const url = buildChaseDispatchShareUrl(token)
  if (!url) return null
  return { token, url }
}

export type ChaseDispatchShareView = ChaseDispatchSharePayload & {
  createdAt: string
}

/** 凭 token 读取快照；过期或不存在返回 null（调用方统一 404） */
export async function loadChaseDispatchShareSnapshot(
  token: string,
): Promise<ChaseDispatchShareView | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(schema.chaseDispatchShareSnapshots)
    .where(eq(schema.chaseDispatchShareSnapshots.token, token))
    .limit(1)
  const row = rows[0]
  if (!row) return null

  const age = Date.now() - new Date(row.createdAt).getTime()
  if (age > CHASE_DISPATCH_SHARE_TTL_MS) return null

  const payload = row.payload as ChaseDispatchSharePayload
  if (!payload || typeof payload !== 'object') return null

  // 异步更新访问时间，不阻塞响应
  void db
    .update(schema.chaseDispatchShareSnapshots)
    .set({ lastAccessedAt: new Date() })
    .where(eq(schema.chaseDispatchShareSnapshots.id, row.id))
    .catch(() => undefined)

  return {
    vendorCode: String(payload.vendorCode ?? row.vendorCode),
    vendorName: String(payload.vendorName ?? row.vendorName),
    baseDate: String(payload.baseDate ?? row.baseDate),
    pushTime: String(payload.pushTime ?? row.pushTime),
    totalStagnant: typeof payload.totalStagnant === 'number' ? payload.totalStagnant : 0,
    priorityTotal: typeof payload.priorityTotal === 'number' ? payload.priorityTotal : 0,
    buckets: Array.isArray(payload.buckets) ? payload.buckets : [],
    createdAt: new Date(row.createdAt).toISOString(),
  }
}
