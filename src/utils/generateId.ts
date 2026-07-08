/** 非安全上下文（如 HTTP）下浏览器不提供 crypto.randomUUID，需手动降级。 */
function fallbackUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 生成唯一 ID；HTTPS / localhost 用 crypto.randomUUID，HTTP 等环境自动降级。 */
export function generateId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === 'function') {
    try {
      return randomUUID.call(globalThis.crypto)
    } catch {
      // 部分环境 randomUUID 存在但调用仍失败
    }
  }
  return fallbackUuid()
}
