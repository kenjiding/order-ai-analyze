import cron from 'node-cron'
import { runScheduledFeishuPush } from '../feishu/scheduledPush'
import { logExitAlarmSchedulerReadiness, runExitAlarmScheduledPush } from '../feishu/exitAlarmScheduledPush'
import {
  logChaseDispatchSchedulerReadiness,
  runChaseDispatchScheduledPush,
} from '../feishu/chaseDispatchScheduledPush'
import {
  logWorkOrderPushSchedulerReadiness,
  runWorkOrderPushScheduledPush,
} from '../feishu/workOrderPushScheduledPush'
import {
  logDispatchAlarmSchedulerReadiness,
  runDispatchAlarmScheduledPush,
} from '../feishu/dispatchAlarmScheduledPush'
import {
  logInboundIndexSchedulerReadiness,
  runDailyInboundWaybillIndexPrefetch,
} from '../imile/inboundWaybillIndexScheduler'
import {
  logDispatchPerformanceReadiness,
  runDispatchPerformanceDailyStats,
} from '../dispatch24hStats/dailyStatsJob'
import { purgeOldDispatchPerformanceStats } from '../dispatch24hStats/repository'
import { INBOUND_INDEX_ADELAIDE_TZ } from '../imile/inboundWaybillIndex'
import { purgeOldVendorDailyData } from '../vendorAnalysis/retention'
import { purgeOldPushEngagementData } from '../feishu/pushEngagementRetention'
import { purgeOldChaseDispatchShareSnapshots } from '../feishu/chaseDispatchShareSnapshot'
import { purgeOldDispatchAlarmShareSnapshots } from '../feishu/dispatchAlarmShareSnapshot'
import { purgeOldDriverMapWaybillPoints } from '../driverMap/driverMapPointsQuery'
import { runImileTokenHealthCheck } from '../imile/tokenHealthCheck'
import {
  DEFAULT_IMILE_TOKEN_CHECK_CRON,
  readImileTokenCheckCron,
  readImileTokenCheckTimeZone,
  readJobSchedulerEnabled,
} from './config'

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

  // 催派推送：worker 内始终注册，是否执行由 DB 配置 isEnabled 控制
  const chaseDispatchTask = cron.schedule(
    '* * * * *',
    async () => {
      try {
        await runChaseDispatchScheduledPush()
      } catch (err) {
        console.error('[scheduler/chase-dispatch] 推送异常:', err)
      }
    },
    { timezone: 'Australia/Adelaide' },
  )
  tasks.push(chaseDispatchTask)
  console.log('[scheduler] 已启动催派推送检查任务 cron="* * * * *" timezone="Australia/Adelaide"')
  void logChaseDispatchSchedulerReadiness()

  // 工单推送：worker 内始终注册，是否执行由 DB 配置 isEnabled 及 weekdays 控制
  const workOrderPushTask = cron.schedule(
    '* * * * *',
    async () => {
      try {
        await runWorkOrderPushScheduledPush()
      } catch (err) {
        console.error('[scheduler/work-order-push] 推送异常:', err)
      }
    },
    { timezone: 'Australia/Adelaide' },
  )
  tasks.push(workOrderPushTask)
  console.log('[scheduler] 已启动工单推送检查任务 cron="* * * * *" timezone="Australia/Adelaide"')
  void logWorkOrderPushSchedulerReadiness()

  // 24H派签告警：worker 内始终注册，是否执行由 DB 配置 isEnabled 控制
  const dispatchAlarmTask = cron.schedule(
    '* * * * *',
    async () => {
      try {
        await runDispatchAlarmScheduledPush()
      } catch (err) {
        console.error('[scheduler/dispatch-alarm] 推送异常:', err)
      }
    },
    { timezone: 'Australia/Adelaide' },
  )
  tasks.push(dispatchAlarmTask)
  console.log('[scheduler] 已启动24H派签告警检查任务 cron="* * * * *" timezone="Australia/Adelaide"')
  void logDispatchAlarmSchedulerReadiness()

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

  // 出仓派签达成分析结算：每分钟扫一遍，只跑此刻命中自己「触发统计时间」的站点。
  // 触发时刻由每条站点配置自带（默认 16:00），按该站点所属州的本地时间判定 —— 不同州的
  // 站点因此能各按各的本地时间结算，不再被一条全局 cron 绑在阿德莱德时区上。
  // 有没有可结算的到件批次仍由 resolveSettledArrivalDates 的日历推导决定（周日/周一通常为空）。
  const dispatchPerformanceCron = '* * * * *'
  const dispatchPerformanceTask = cron.schedule(dispatchPerformanceCron, async () => {
    await runDispatchPerformanceDailyStats()
  })
  tasks.push(dispatchPerformanceTask)
  console.log(
    `[scheduler] 已启动出仓派签达成分析结算任务 cron="${dispatchPerformanceCron}"（触发时刻按各站点配置）`,
  )
  void logDispatchPerformanceReadiness(dispatchPerformanceCron)

  // 供应商日报/分享链接 + 催派分享快照保留期清理：每日 06:30 阿德莱德
  const vendorReportRetentionCron = process.env.VENDOR_REPORT_RETENTION_CRON?.trim() || '30 6 * * *'
  const vendorReportRetentionCronValid = cron.validate(vendorReportRetentionCron)
    ? vendorReportRetentionCron
    : '30 6 * * *'
  if (!cron.validate(vendorReportRetentionCron)) {
    console.error(
      `[scheduler] VENDOR_REPORT_RETENTION_CRON 表达式无效: "${vendorReportRetentionCron}"，使用默认值 "30 6 * * *"`,
    )
  }
  const vendorReportRetentionTask = cron.schedule(
    vendorReportRetentionCronValid,
    async () => {
      try {
        const { reports, links } = await purgeOldVendorDailyData()
        console.log(`[scheduler/vendor-report-retention] 已清理 ${reports} 条日报 / ${links} 条分享链接`)
      } catch (err) {
        console.error('[scheduler/vendor-report-retention] 清理异常:', err)
      }
      try {
        const purged = await purgeOldChaseDispatchShareSnapshots()
        if (purged > 0) {
          console.log(`[scheduler/chase-dispatch-share-retention] 已清理 ${purged} 条催派分享快照`)
        }
      } catch (err) {
        console.error('[scheduler/chase-dispatch-share-retention] 清理异常:', err)
      }
      try {
        const purged = await purgeOldDispatchAlarmShareSnapshots()
        if (purged > 0) {
          console.log(`[scheduler/dispatch-alarm-share-retention] 已清理 ${purged} 条派签告警分享快照`)
        }
      } catch (err) {
        console.error('[scheduler/dispatch-alarm-share-retention] 清理异常:', err)
      }
      try {
        const purged = await purgeOldDriverMapWaybillPoints()
        if (purged > 0) {
          console.log(`[scheduler/driver-map-retention] 已清理 ${purged} 条司机地图缓存点位`)
        }
      } catch (err) {
        console.error('[scheduler/driver-map-retention] 清理异常:', err)
      }
      try {
        const purged = await purgeOldDispatchPerformanceStats()
        if (purged > 0) {
          console.log(`[scheduler/dispatch-performance-retention] 已清理 ${purged} 条出仓派签日度指标`)
        }
      } catch (err) {
        console.error('[scheduler/dispatch-performance-retention] 清理异常:', err)
      }
      try {
        const { pushMessages, clickEvents } = await purgeOldPushEngagementData()
        if (pushMessages > 0 || clickEvents > 0) {
          console.log(
            `[scheduler/push-engagement-retention] 已清理 ${pushMessages} 条推送记录 / ${clickEvents} 条点击事件`,
          )
        }
      } catch (err) {
        console.error('[scheduler/push-engagement-retention] 清理异常:', err)
      }
    },
    { timezone: INBOUND_INDEX_ADELAIDE_TZ },
  )
  tasks.push(vendorReportRetentionTask)
  console.log(
    `[scheduler] 已启动供应商日报/催派分享/司机地图/推送数据监控保留期清理任务 cron="${vendorReportRetentionCronValid}" timezone="${INBOUND_INDEX_ADELAIDE_TZ}"`,
  )

  // iMile token 失效检测：默认墨尔本时间每天 08:00 与 15:00 各一次，可用 env 覆盖
  const imileTokenCheckCron = readImileTokenCheckCron()
  if (!cron.validate(imileTokenCheckCron)) {
    console.error(
      `[scheduler] IMILE_TOKEN_CHECK_CRON 表达式无效: "${imileTokenCheckCron}"，使用默认值 "${DEFAULT_IMILE_TOKEN_CHECK_CRON}"`,
    )
  }
  const imileTokenCheckCronValid = cron.validate(imileTokenCheckCron)
    ? imileTokenCheckCron
    : DEFAULT_IMILE_TOKEN_CHECK_CRON
  const imileTokenCheckTimeZone = readImileTokenCheckTimeZone()
  const imileTokenCheckTask = cron.schedule(
    imileTokenCheckCronValid,
    async () => {
      try {
        await runImileTokenHealthCheck()
      } catch (err) {
        console.error('[scheduler/imile-token-check] 检测异常:', err)
      }
    },
    { timezone: imileTokenCheckTimeZone },
  )
  tasks.push(imileTokenCheckTask)
  console.log(
    `[scheduler] 已启动 iMile token 失效检测任务 cron="${imileTokenCheckCronValid}" timezone="${imileTokenCheckTimeZone}"`,
  )

  return {
    stop: () => {
      for (const t of tasks) t.stop()
      console.log('[scheduler] 已停止所有定时任务')
    },
  }
}
