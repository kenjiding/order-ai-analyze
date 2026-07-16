import { and, eq } from 'drizzle-orm'
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
