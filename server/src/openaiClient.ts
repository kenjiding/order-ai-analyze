import OpenAI from 'openai'

/**
 * OPENAI_API_BASE 兼容旧写法：若指向 `.../v1/chat/completions` 则裁成 SDK 所需的 base（含 `/v1`）。
 * 未设置时使用官方默认 baseURL。
 */
function baseUrlFromEnv(): string | undefined {
  const raw = process.env.OPENAI_API_BASE?.trim()
  if (!raw) return undefined
  const normalized = raw.replace(/\/chat\/completions\/?$/i, '').replace(/\/$/, '')
  return normalized || undefined
}

export function createOpenAIClient(apiKey: string): OpenAI {
  const baseURL = baseUrlFromEnv()
  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  })
}

/** DeepSeek Chat API（OpenAI SDK 兼容）。可选 DEEPSEEK_API_BASE 覆盖默认 https://api.deepseek.com */
export function createDeepSeekClient(apiKey: string): OpenAI {
  const raw = process.env.DEEPSEEK_API_BASE?.trim()
  const baseURL = raw ? raw.replace(/\/$/, '') : 'https://api.deepseek.com'
  return new OpenAI({
    apiKey,
    baseURL,
  })
}
