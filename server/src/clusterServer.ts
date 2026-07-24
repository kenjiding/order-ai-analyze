import cluster from 'node:cluster'

export type ClusterServerOptions = {
  /** worker 进程数 */
  workerCount: number
  /** primary 进程里 fork worker 之前执行且只执行一次的初始化（如数据库 migration），避免多个 worker 并发跑 migration 产生竞态 */
  beforeFork: () => Promise<void>
  /** 每个 worker 进程要执行的启动逻辑（如 app.listen） */
  startWorker: () => Promise<void>
}

/**
 * 以 Node cluster 运行 HTTP 服务：primary 进程只做一次性初始化与拉起/重拉 worker，
 * 请求处理都在 worker 进程里跑，充分利用多核；primary 进程本身的存活仍交给容器层（Podman/systemd）负责。
 */
export async function runClusterServer(options: ClusterServerOptions): Promise<void> {
  if (cluster.isPrimary) {
    await runPrimary(options)
    return
  }

  // 终端 Ctrl+C 发出的 SIGINT 会广播给整个前台进程组（primary 和所有 worker 都在同一组），
  // worker 若不拦截就会立刻按默认行为退出——早于 primary 自己的信号处理逻辑，
  // 导致 primary 的 cluster.on('exit') 在 shuttingDown 标记为 true 之前就先看到 worker 退出而误判为异常重拉。
  // 拦截后 worker 只通过 primary 调用 cluster.disconnect() 时的 IPC 通知来优雅退出，消除这个竞态。
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => {})
  await options.startWorker()
}

/** 崩溃循环判定窗口：窗口内退出次数超过此值就放弃重拉，交给容器层重启（见下方说明） */
const CRASH_LOOP_WINDOW_MS = 10_000

/** 优雅退出等待上限：worker 若因残留连接（本地常见于浏览器保持的 keep-alive）迟迟不关闭，超时后强杀，避免 Ctrl+C 卡死 */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000

async function runPrimary(options: ClusterServerOptions): Promise<void> {
  await options.beforeFork()

  for (let i = 0; i < options.workerCount; i++) {
    cluster.fork()
  }

  let shuttingDown = false
  const recentExitTimestamps: number[] = []
  const crashLoopMaxExits = options.workerCount * 3

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return
    console.error(`[cluster] worker pid=${worker.process.pid} exited (code=${code} signal=${signal ?? 'none'})`)

    const now = Date.now()
    recentExitTimestamps.push(now)
    while (recentExitTimestamps.length && now - recentExitTimestamps[0] > CRASH_LOOP_WINDOW_MS) {
      recentExitTimestamps.shift()
    }

    // worker 若在启动阶段就持续失败（如端口被占用），无脑重拉会变成 fork 炸弹；
    // 达到阈值就放弃并让 primary 以非 0 退出，改由容器层（Podman/systemd）重启整个容器。
    if (recentExitTimestamps.length > crashLoopMaxExits) {
      console.error(
        `[cluster] ${recentExitTimestamps.length} worker exits within ${CRASH_LOOP_WINDOW_MS}ms — crash loop detected, giving up`,
      )
      shuttingDown = true
      process.exit(1)
      return
    }

    console.error('[cluster] refork')
    cluster.fork()
  })

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[cluster] primary received ${signal}, disconnecting workers`)

    // 实测发现 cluster.disconnect() 的回调不能保证 worker 底层 OS 进程已经真正退出：
    // 若 worker 上还挂着未关闭的连接（本地常见于浏览器保持的 keep-alive），回调仍可能很快触发、
    // primary 随之 exit，但该 worker 会变成孤儿进程继续占着端口。所以退出前显式记下所有 worker
    // pid，无论走哪条路径（超时兜底 / disconnect 回调正常完成）都强杀一遍残留的 worker。
    const workerPids = Object.values(cluster.workers ?? {})
      .map((worker) => worker?.process.pid)
      .filter((pid): pid is number => typeof pid === 'number')

    const killLingeringWorkers = (): void => {
      for (const pid of workerPids) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // 进程已退出，忽略
        }
      }
    }

    const forceKillTimer = setTimeout(() => {
      console.error(
        `[cluster] graceful shutdown 超过 ${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms 仍未完成，强制退出`,
      )
      killLingeringWorkers()
      process.exit(1)
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS)

    cluster.disconnect(() => {
      clearTimeout(forceKillTimer)
      killLingeringWorkers()
      process.exit(0)
    })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  console.log(`[cluster] primary pid=${process.pid} started ${options.workerCount} worker(s)`)
}
