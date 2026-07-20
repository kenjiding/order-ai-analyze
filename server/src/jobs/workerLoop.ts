import { setTimeout as sleep } from 'node:timers/promises'
import type { Job } from '../db/schema'
import { cleanupExpiredArtifacts } from './artifactStore'
import {
  readJobArtifactCleanupIntervalMs,
  readJobPollIntervalMs,
  readJobStaleLockMinutes,
  readJobWorkerConcurrency,
} from './config'
import { getJobHandler } from './registry'
import {
  claimNextJob,
  completeJob,
  failJob,
  recoverStaleRunningJobs,
  updateJobProgress,
} from './queue'

async function executeJob(job: Job): Promise<void> {
  const handler = getJobHandler(job.type)
  if (!handler) {
    await failJob(job.id, `handler_not_registered:${job.type}`)
    return
  }

  const controller = new AbortController()
  try {
    const result = await handler.run({
      job,
      signal: controller.signal,
      reportProgress: async (progress) => {
        await updateJobProgress(job.id, progress)
      },
    })

    const completed = await completeJob(job.id, result.artifactPayload ?? null)
    if (!completed) {
      console.warn(`[worker] job ${job.id} complete ignored (not running)`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[worker] job ${job.id} failed`, message)
    await failJob(job.id, message)
  } finally {
    controller.abort()
  }
}

export type WorkerLoopHandle = {
  stop: () => Promise<void>
}

export async function startWorkerLoop(workerId: string): Promise<WorkerLoopHandle> {
  const concurrency = readJobWorkerConcurrency()
  const pollIntervalMs = readJobPollIntervalMs()
  const staleLockMinutes = readJobStaleLockMinutes()
  let running = true
  let activeCount = 0
  const waiters: Array<() => void> = []

  const notifySlot = () => {
    const next = waiters.shift()
    next?.()
  }

  const acquireSlot = async (): Promise<void> => {
    if (activeCount < concurrency) {
      activeCount += 1
      return
    }
    await new Promise<void>((resolve) => {
      waiters.push(resolve)
    })
    activeCount += 1
  }

  const releaseSlot = () => {
    activeCount = Math.max(0, activeCount - 1)
    notifySlot()
  }

  const pollOnce = async () => {
    if (!running) return
    await recoverStaleRunningJobs(staleLockMinutes)

    while (running && activeCount < concurrency) {
      const job = await claimNextJob(workerId)
      if (!job) break

      await acquireSlot()
      void executeJob(job)
        .catch((error) => {
          console.error('[worker] unexpected job error', error)
        })
        .finally(() => {
          releaseSlot()
        })
    }
  }

  const pollTimer = setInterval(() => {
    void pollOnce()
  }, pollIntervalMs)

  const cleanupTimer = setInterval(() => {
    void cleanupExpiredArtifacts()
      .then((removed) => {
        if (removed > 0) console.log(`[worker] cleaned ${removed} expired artifact payload(s)`)
      })
      .catch((error) => {
        console.error('[worker] artifact cleanup failed', error)
      })
  }, readJobArtifactCleanupIntervalMs())

  void pollOnce()

  return {
    stop: async () => {
      running = false
      clearInterval(pollTimer)
      clearInterval(cleanupTimer)
      while (activeCount > 0) {
        await sleep(200)
      }
    },
  }
}

export async function runWorkerForever(workerId: string): Promise<void> {
  const loop = await startWorkerLoop(workerId)
  const shutdown = async () => {
    console.log('[worker] shutting down...')
    await loop.stop()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown()
  })
  process.on('SIGTERM', () => {
    void shutdown()
  })
}
