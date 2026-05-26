/** DeepSeek 推理模型（如 deepseek-reasoner）不支持 temperature/top_p 等采样参数 */
export function deepSeekModelOmitsSamplingParams(model: string): boolean {
  return model.trim().toLowerCase().includes('reasoner')
}

export function readAnalyzeConcurrency(): number {
  const raw = Number.parseInt(String(process.env.ORDER_ANALYZE_CONCURRENCY ?? ''), 10)
  if (!Number.isFinite(raw)) return 3
  if (raw < 1) return 1
  if (raw > 6) return 6
  return raw
}

export function readAnalyzeChunkSize(): number {
  const raw = Number.parseInt(String(process.env.ORDER_ANALYZE_CHUNK_SIZE ?? ''), 10)
  if (!Number.isFinite(raw)) return 2
  if (raw < 1) return 1
  if (raw > 5) return 5
  return raw
}
