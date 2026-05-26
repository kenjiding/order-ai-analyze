/**
 * 飞书 webhook 推送限流保护：延迟 + 重试。
 *
 * 飞书自定义机器人限制：5 条/秒、100 条/分钟。
 * 通过请求间延迟 + 失败时指数退避重试来避免漏发。
 */

const PUSH_INTERVAL_MS = 260

let lastPushAt = 0

/**
 * 在两次 webhook 调用之间插入最小间隔，避免触发 5 条/秒限制。
 */
export async function throttlePush(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastPushAt
  if (elapsed < PUSH_INTERVAL_MS) {
    await sleep(PUSH_INTERVAL_MS - elapsed)
  }
  lastPushAt = Date.now()
}

/**
 * 带重试的异步调用包装。对限流/网络错误做最多 maxRetries 次指数退避重试。
 */
export async function withRetry<T extends { ok: boolean }>(
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  let lastResult: T | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await throttlePush()
    lastResult = await fn()
    if (lastResult.ok) return lastResult
    if (attempt < maxRetries) {
      const backoff = (attempt + 1) * 500
      await sleep(backoff)
    }
  }
  return lastResult!
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
