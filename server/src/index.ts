import os from 'node:os'
import './loadEnv'
import { runClusterServer } from './clusterServer'
import { bootstrapDatabase } from './db/migrate'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const WORKER_COUNT = (() => {
  const fromEnv = Number(process.env.WEB_CONCURRENCY)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv)
  return Math.max(1, os.cpus().length - 1)
})()

async function startWorker(): Promise<void> {
  const { app } = await import('./app')
  app.listen(PORT, HOST, () => {
    console.log(`[server] worker pid=${process.pid} http://${HOST}:${PORT}`)
  })
}

runClusterServer({
  workerCount: WORKER_COUNT,
  beforeFork: bootstrapDatabase,
  startWorker,
}).catch((error) => {
  console.error('[server] failed to start', error)
  process.exit(1)
})
