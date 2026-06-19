import cron from 'node-cron'
import { runScheduledFeishuPush } from '../feishu/scheduledPush'

export function startJobScheduler(): { stop: () => void } {
  const enabled = String(process.env.JOB_SCHEDULER_ENABLED ?? '').trim().toLowerCase() === 'true'
  if (!enabled) {
    console.log('[scheduler] disabled (JOB_SCHEDULER_ENABLED!=true)')
    return { stop: () => {} }
  }

  const tasks: ReturnType<typeof cron.schedule>[] = []

  // 飞书效率定时推送
  const feishuCron = process.env.FEISHU_SCHEDULE_CRON?.trim() || '0 9 * * 1-5'
  if (!cron.validate(feishuCron)) {
    console.error(`[scheduler] FEISHU_SCHEDULE_CRON 表达式无效: "${feishuCron}"，使用默认值 "0 9 * * 1-5"`)
  }
  const validFeishuCron = cron.validate(feishuCron) ? feishuCron : '0 9 * * 1-5'
  const timezone = process.env.FEISHU_SCHEDULE_TIMEZONE?.trim() || 'Asia/Shanghai'

  const feishuTask = cron.schedule(
    validFeishuCron,
    async () => {
      console.log('[scheduler/feishu] 触发定时推送')
      try {
        await runScheduledFeishuPush()
      } catch (err) {
        console.error('[scheduler/feishu] 推送异常:', err)
      }
    },
    { timezone },
  )
  tasks.push(feishuTask)

  console.log(`[scheduler] 已启动 feishu 推送任务 cron="${validFeishuCron}" timezone="${timezone}"`)

  return {
    stop: () => {
      for (const t of tasks) t.stop()
      console.log('[scheduler] 已停止所有定时任务')
    },
  }
}
