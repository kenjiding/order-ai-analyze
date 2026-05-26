/** 单次分析流程内大模型 API 的 token 汇总（跨 chunk / 精排 / 重试累加）。 */
export type TokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** 实际发起的 chat completion 次数 */
  apiCalls: number
}

export function emptyTokenUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 }
}

export function mergeTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    apiCalls: a.apiCalls + b.apiCalls,
  }
}

type CompletionUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export function extractTokenUsage(completion: { usage?: CompletionUsage | null }): TokenUsage {
  const u = completion.usage
  if (!u) {
    return { ...emptyTokenUsage(), apiCalls: 1 }
  }
  const prompt = Number(u.prompt_tokens) || 0
  const completionTokens = Number(u.completion_tokens) || 0
  const total = Number(u.total_tokens) || prompt + completionTokens
  return {
    promptTokens: prompt,
    completionTokens,
    totalTokens: total,
    apiCalls: 1,
  }
}
