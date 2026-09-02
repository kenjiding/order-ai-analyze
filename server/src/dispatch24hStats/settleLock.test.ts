import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withSettleLock } from './dailyStatsJob'

/**
 * cron 与「立刻统计」作业同在 worker 进程里跑同样的 delete+insert，必须串行。
 * 这里只验锁本身：重叠调用不会交错，且一次抛错不会卡死后面的排队。
 */
test('withSettleLock：并发调用严格串行，异常不卡死队列', async () => {
  const log: string[] = []
  const task = (name: string, fail = false) =>
    withSettleLock(async () => {
      log.push(`${name}:start`)
      await new Promise((r) => setTimeout(r, 10))
      log.push(`${name}:end`)
      if (fail) throw new Error(name)
      return name
    })

  const a = task('a')
  const b = task('b', true)
  const c = task('c')

  assert.equal(await a, 'a')
  await assert.rejects(b, /b/)
  assert.equal(await c, 'c')
  assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end'])
})
