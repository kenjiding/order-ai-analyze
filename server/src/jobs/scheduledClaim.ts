import { and, eq, inArray } from 'drizzle-orm'
import { getDb, schema } from '../db'

/** 定时推送幂等键：以「触发日 + 配置时刻」标识一次应发生的推送。 */
export function formatScheduledPushSlotKey(slot: { dateStr: string; timeHHmm: string }): string {
  return `${slot.dateStr}|${slot.timeHHmm}`
}

/**
 * 抢占一个 (jobKey, slotKey) 定时任务时间槽：插入成功才允许继续执行推送等副作用。
 * 依赖 scheduled_job_claims 的唯一索引兜底并发/多 worker 重复触发；返回 false 表示已被抢占，调用方应跳过本次执行。
 *
 * jobKey 标识任务与归属实体，如 `exit-alarm:${scheduleId}`；
 * slotKey 标识具体命中的时间槽，如 `${dateStr}|${timeHHmm}`（每分钟轮询任务）或 `${dateStr}`（每日一次任务）。
 */
export async function claimScheduledSlot(jobKey: string, slotKey: string): Promise<boolean> {
  const db = getDb()
  const inserted = await db
    .insert(schema.scheduledJobClaims)
    .values({ jobKey, slotKey })
    .onConflictDoNothing()
    .returning({ id: schema.scheduledJobClaims.id })
  return inserted.length > 0
}

/**
 * 推送失败时释放已抢占的时间槽，使补跑窗口内可以重试。
 * 仅在「确认需要重试」时调用；全部 webhook 已成功或业务上确定无需再推时不要释放。
 */
export async function releaseScheduledSlot(jobKey: string, slotKey: string): Promise<void> {
  const db = getDb()
  await db
    .delete(schema.scheduledJobClaims)
    .where(and(eq(schema.scheduledJobClaims.jobKey, jobKey), eq(schema.scheduledJobClaims.slotKey, slotKey)))
}

/**
 * 统计给定 slotKey 下，jobKeys 里有多少个已经被 claim（即已经成功处理过）。
 * 供「按子任务（如单个供应商配置）粒度幂等」场景在发起正式处理前快速判断：
 * 如果这批 jobKeys 已全部 claim，说明本时间槽这批子任务都已完成，调用方可以跳过后续的取数/处理，
 * 避免 catch-up 重试窗口内每分钟都重新拉一遍上游数据。
 */
export async function countClaimedSlots(jobKeys: string[], slotKey: string): Promise<number> {
  if (jobKeys.length === 0) return 0
  const db = getDb()
  const rows = await db
    .select({ jobKey: schema.scheduledJobClaims.jobKey })
    .from(schema.scheduledJobClaims)
    .where(and(inArray(schema.scheduledJobClaims.jobKey, jobKeys), eq(schema.scheduledJobClaims.slotKey, slotKey)))
  return rows.length
}
