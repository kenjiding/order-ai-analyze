import { getDb, schema } from '../db'

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
