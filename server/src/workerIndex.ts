import './loadEnv'
import { bootstrapDatabase } from './db/migrate'
import { closeDb } from './db/index'
import { createWorkerId } from './jobs/config'
import { registerBuiltInJobHandlers } from './jobs/handlers'
import { startJobScheduler } from './jobs/scheduler'
import { listRegisteredJobTypes } from './jobs/registry'
import { runWorkerForever } from './jobs/workerLoop'

async function main() {
  await bootstrapDatabase()
  registerBuiltInJobHandlers()

  const workerId = createWorkerId()
  const scheduler = startJobScheduler()

  console.log(`[worker] started id=${workerId} handlers=${listRegisteredJobTypes().join(', ')}`)

  process.on('exit', () => {
    scheduler.stop()
  })

  await runWorkerForever(workerId)
}

main().catch(async (error) => {
  console.error('[worker] failed to start', error)
  await closeDb()
  process.exit(1)
})
