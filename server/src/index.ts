import os from 'node:os'
import './loadEnv'
import { runClusterServer } from './clusterServer'
import { bootstrapDatabase } from './db/migrate'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const WORKER_COUNT = (() => {
  const fromEnv = Number(process.env.WEB_CONCURRENCY)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv)
  return Math.max(1, os.cpus().length - 1)
})()

async function startWorker(): Promise<void> {
  const { app } = await import('./app')
  // 品类字典的同步快照要在第一个请求前热起来：冷快照只认内置品类，新建的品类会被判成不合法
  const { warmContainerTypeCache } = await import('./containerManagement/containerTypeService')
  await warmContainerTypeCache()
  app.listen(PORT, HOST, () => {
    console.log(`[server] worker pid=${process.pid} http://${HOST}:${PORT}`)
  })
}

async function main(): Promise<void> {
  if (!IS_PRODUCTION) {
    // 开发环境单进程直接启动，不走 cluster fork：
    // fork 出的子进程脱离 tsx watch 对主进程的生命周期管理，改代码重启时容易变成孤儿进程占着端口。
    await bootstrapDatabase()
    await startWorker()
    return
  }

  await runClusterServer({
    workerCount: WORKER_COUNT,
    beforeFork: bootstrapDatabase,
    startWorker,
  })
}

main().catch((error) => {
  console.error('[server] failed to start', error)
  process.exit(1)
})
