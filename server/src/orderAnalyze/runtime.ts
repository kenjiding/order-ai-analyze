export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return []
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length))
  const out = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const idx = cursor
      cursor += 1
      if (idx >= items.length) break
      out[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
  return out
}

export function chunkTargets<T>(targets: T[], chunkSize: number): T[][] {
  if (!targets.length) return []
  const size = Math.max(1, chunkSize)
  const out: T[][] = []
  for (let i = 0; i < targets.length; i += size) {
    out.push(targets.slice(i, i + size))
  }
  return out
}
