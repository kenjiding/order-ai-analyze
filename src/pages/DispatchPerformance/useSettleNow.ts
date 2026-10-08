import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJobArtifact, getJobById } from '../../api/jobsClient'
import { showToast } from '../../utils/toast'
import { postSettleNow } from './dispatchPerformanceApi'
import type { SettleNowArtifact } from './dispatchPerformanceTypes'

const JOB_POLL_INTERVAL_MS = 2000
/** 轮询上限 10 分钟：作业卡死或接口一直失败时按钮不能永远转圈 */
const JOB_POLL_MAX_TICKS = (10 * 60_000) / JOB_POLL_INTERVAL_MS

/**
 * 「立刻统计」的触发 + 轮询，列表行和详情页共用。
 *
 * 走作业队列而不是同步请求：结算跑在 worker 进程，一次要打若干次 iMile，
 * 同步等会超时；队列还顺带解决了跨进程互斥（见后端 dispatchPerformanceSettleHandler）。
 *
 * `settlingId` 记的是配置 id，列表页据此只让被点的那一行转圈。
 */
export function useSettleNow(options?: { onSettled?: () => void | Promise<void> }) {
  const { t } = useTranslation('dispatchPerformance')
  const toast = useMemo(
    () => ({
      jobAlreadyRunning: t('toast.jobAlreadyRunning'),
      jobPollTimeout: t('toast.jobPollTimeout'),
      settleComplete: t('toast.settleComplete'),
      unknownError: t('toast.unknownError'),
      triggerSettleFailed: t('toast.triggerSettleFailed'),
    }),
    [t],
  )

  const [settlingId, setSettlingId] = useState<string | null>(null)
  const [artifact, setArtifact] = useState<SettleNowArtifact | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const onSettledRef = useRef(options?.onSettled)

  useEffect(() => {
    onSettledRef.current = options?.onSettled
  }, [options?.onSettled])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  /** 轮询作业直到结束；立刻统计与上传运单表结算共用，结果都是 SettleNowArtifact */
  const trackJob = useCallback(
    (jobId: string) => {
      stopPolling()
      let ticks = 0
      pollTimerRef.current = window.setInterval(async () => {
        if ((ticks += 1) > JOB_POLL_MAX_TICKS) {
          stopPolling()
          setSettlingId(null)
          showToast(toast.jobPollTimeout, 'warning')
          return
        }
        try {
          const current = await getJobById(jobId)
          if (current.status === 'succeeded') {
            stopPolling()
            setSettlingId(null)
            setArtifact(await getJobArtifact<SettleNowArtifact>(jobId))
            await onSettledRef.current?.()
            showToast(toast.settleComplete, 'success')
          } else if (current.status === 'failed' || current.status === 'cancelled') {
            stopPolling()
            setSettlingId(null)
            showToast(
              t('toast.settleFailed', { error: current.error ?? toast.unknownError }),
              'error',
            )
          }
        } catch (err) {
          console.warn('[dispatch-performance] poll settle job failed', err)
        }
      }, JOB_POLL_INTERVAL_MS)
    },
    [stopPolling, t, toast],
  )

  const settleNow = useCallback(
    async (configId: string) => {
      if (settlingId) return
      setSettlingId(configId)
      setArtifact(null)
      try {
        const { job, reused } = await postSettleNow(configId)
        if (reused) showToast(toast.jobAlreadyRunning, 'warning')
        trackJob(job.id)
      } catch (err) {
        setSettlingId(null)
        showToast(err instanceof Error ? err.message : toast.triggerSettleFailed, 'error')
      }
    },
    [settlingId, trackJob, toast],
  )

  /** 上传运单表结算：作业已由上传弹窗入队，这里只接管轮询与结果展示 */
  const trackUploadJob = useCallback(
    (configId: string, jobId: string) => {
      setSettlingId(configId)
      setArtifact(null)
      trackJob(jobId)
    },
    [trackJob],
  )

  return {
    settlingId,
    settling: settlingId != null,
    artifact,
    settleNow,
    trackUploadJob,
    dismissArtifact: useCallback(() => setArtifact(null), []),
  }
}
