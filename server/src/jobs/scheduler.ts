/** 定时调度占位：业务 cron 未确定前默认关闭。 */
export function startJobScheduler(): { stop: () => void } {
  const enabled = String(process.env.JOB_SCHEDULER_ENABLED ?? '').trim().toLowerCase() === 'true'
  if (!enabled) {
    console.log('[scheduler] disabled (JOB_SCHEDULER_ENABLED!=true)')
    return { stop: () => {} }
  }

  console.log('[scheduler] enabled but no schedules configured yet')
  return { stop: () => {} }
}
