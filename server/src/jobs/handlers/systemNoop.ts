import { setTimeout as sleep } from 'node:timers/promises'
import type { JobHandler } from '../types'

export const SYSTEM_NOOP_JOB_TYPE = 'system.noop'

export const systemNoopHandler: JobHandler = {
  type: SYSTEM_NOOP_JOB_TYPE,
  async run(ctx) {
    await ctx.reportProgress({ phase: 'noop', message: 'running' })
    await sleep(1000)
    if (ctx.signal.aborted) {
      throw new Error('job aborted')
    }

    const artifactRelPath = await ctx.artifact.writeJson({
      ok: true,
      type: SYSTEM_NOOP_JOB_TYPE,
      jobId: ctx.job.id,
      echoed: ctx.job.payload,
      finishedAt: new Date().toISOString(),
    })

    await ctx.reportProgress({ phase: 'noop', message: 'done', percent: 100 })
    return { artifactRelPath }
  },
}
