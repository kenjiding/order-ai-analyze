import cron from 'node-cron'
import { runScheduledFeishuPush } from '../feishu/scheduledPush'
import { logExitAlarmSchedulerReadiness, runExitAlarmScheduledPush } from '../feishu/exitAlarmScheduledPush'
import {
  logInboundIndexSchedulerReadiness,
  runDailyInboundWaybillIndexPrefetch,
} from '../imile/inboundWaybillIndexScheduler'
import { INBOUND_INDEX_ADELAIDE_TZ } from '../imile/inboundWaybillIndex'
import { readJobSchedulerEnabled } from './config'

export function startJobScheduler(): { stop: () => void } {
  const tasks: ReturnType<typeof cron.schedule>[] = []

  // 飞书效率定时推送（需显式开启 JOB_SCHEDULER_ENABLED）
  if (readJobSchedulerEnabled()) {
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
  } else {
    console.log('[scheduler] feishu 推送未启用 (JOB_SCHEDULER_ENABLED!=true)')
  }

  // 出仓告警：worker 内始终注册，是否执行由 DB 配置 isEnabled 控制
  const exitAlarmTask = cron.schedule(
    '* * * * *',
    async () => {
      try {
        await runExitAlarmScheduledPush()
      } catch (err) {
        console.error('[scheduler/exit-alarm] 推送异常:', err)
      }
    },
    { timezone: 'Australia/Adelaide' },
  )
  tasks.push(exitAlarmTask)
  console.log('[scheduler] 已启动出仓告警检查任务 cron="* * * * *" timezone="Australia/Adelaide"')
  void logExitAlarmSchedulerReadiness()

  // 到件 waybillNo 索引：每日 06:00 阿德莱德预取昨天 inbound/query（与出仓告警解耦）
  const inboundIndexCron = process.env.INBOUND_INDEX_CRON?.trim() || '0 6 * * *'
  const inboundIndexCronValid = cron.validate(inboundIndexCron) ? inboundIndexCron : '0 6 * * *'
  if (!cron.validate(inboundIndexCron)) {
    console.error(`[scheduler] INBOUND_INDEX_CRON 表达式无效: "${inboundIndexCron}"，使用默认值 "0 6 * * *"`)
  }
  const inboundIndexTask = cron.schedule(
    inboundIndexCronValid,
    async () => {
      console.log('[scheduler/inbound-index] 触发到件 waybillNo 索引预取')
      try {
        await runDailyInboundWaybillIndexPrefetch()
      } catch (err) {
        console.error('[scheduler/inbound-index] 预取异常:', err)
      }
    },
    { timezone: INBOUND_INDEX_ADELAIDE_TZ },
  )
  tasks.push(inboundIndexTask)
  console.log(
    `[scheduler] 已启动到件索引预取任务 cron="${inboundIndexCronValid}" timezone="${INBOUND_INDEX_ADELAIDE_TZ}"`,
  )
  void logInboundIndexSchedulerReadiness()

  return {
    stop: () => {
      for (const t of tasks) t.stop()
      console.log('[scheduler] 已停止所有定时任务')
    },
  }
}
