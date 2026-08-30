import { useCallback, useEffect, useRef, useState } from 'react'
import { getJobArtifact, getJobById } from '../../api/jobsClient'
import { showToast } from '../../utils/toast'
import { postSettleNow } from './dispatchPerformanceApi'
import type { SettleNowArtifact } from './dispatchPerformanceTypes'

const JOB_POLL_INTERVAL_MS = 2000

/**
 * 「立刻统计」的触发 + 轮询，列表行和详情页共用。
 *
 * 走作业队列而不是同步请求：结算跑在 worker 进程，一次要打若干次 iMile，
 * 同步等会超时；队列还顺带解决了跨进程互斥（见后端 dispatchPerformanceSettleHandler）。
 *
 * `settlingId` 记的是配置 id，列表页据此只让被点的那一行转圈。
 */
export function useSettleNow(options?: { onSettled?: () => void | Promise<void> }) {
  const [settlingId, setSettlingId] = useState<string | null>(null)
  const [artifact, setArtifact] = useState<SettleNowArtifact | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  // 轮询回调里要用最新的 onSettled，又不能让它进依赖数组反复重建定时器
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

  // 卸载时必须清定时器，否则轮询继续跑并对已卸载组件 setState
  useEffect(() => stopPolling, [stopPolling])

  const settleNow = useCallback(
    async (configId: string) => {
      if (settlingId) return
      setSettlingId(configId)
      setArtifact(null)
      try {
        const { job, reused } = await postSettleNow(configId)
        if (reused) showToast('该站点已有统计任务在跑，正在等它完成', 'warning')

        stopPolling()
        pollTimerRef.current = window.setInterval(async () => {
          try {
            const current = await getJobById(job.id)
            if (current.status === 'succeeded') {
              stopPolling()
              setSettlingId(null)
              setArtifact(await getJobArtifact<SettleNowArtifact>(job.id))
              await onSettledRef.current?.()
              showToast('统计完成', 'success')
            } else if (current.status === 'failed' || current.status === 'cancelled') {
              stopPolling()
              setSettlingId(null)
              showToast(`统计失败：${current.error ?? '未知错误'}`, 'error')
            }
            // pending / running：继续轮询
          } catch (err) {
            // 单次轮询失败不中断，等下一轮重试
            console.warn('[dispatch-performance] 轮询统计任务失败', err)
          }
        }, JOB_POLL_INTERVAL_MS)
      } catch (err) {
        setSettlingId(null)
        showToast(err instanceof Error ? err.message : '触发统计失败', 'error')
      }
    },
    [settlingId, stopPolling],
  )

  return {
    settlingId,
    settling: settlingId != null,
    artifact,
    settleNow,
    dismissArtifact: useCallback(() => setArtifact(null), []),
  }
}
