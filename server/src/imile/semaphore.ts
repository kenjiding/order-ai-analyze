/** 简单计数信号量，用于限制同一进程内并发 iMile 请求数 */
export class Semaphore {
  private pending = 0
  private readonly waiters: (() => void)[] = []

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    if (this.pending < this.max) {
      this.pending++
      return Promise.resolve()
    }
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  release(): void {
    const next = this.waiters.shift()
    if (next) {
      next()
    } else {
      this.pending--
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}
