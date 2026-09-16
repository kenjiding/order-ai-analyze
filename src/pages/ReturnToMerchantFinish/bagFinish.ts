/** 退返商家完结的两条纯逻辑：提交前按集包号去重、按 blockCode 判成功。不引入任何依赖以便单测直接跑。 */

export type BagLike = {
  bagNumber: string
  targetCode: string
  waybillTotalCount: number
}

export type BagFinishOutcome = {
  ok: boolean
  blockCode?: number | null
}

/**
 * 成功闭环：iMile 没有阻断。实测成功时返回体压根不带 blockCode（为 null），
 * 只有被拦截才回非 0 的 blockCode + blockInfo，所以 null 与 0 一律算成功。
 */
export function isBagFinishSuccess(result: BagFinishOutcome | undefined): boolean {
  if (!result?.ok) return false
  return result.blockCode == null || result.blockCode === 0
}

/** 同一集包号只提交一次；没有退返商家编码的集包不能提交，直接剔除 */
export function dedupeBagsForSubmit<T extends BagLike>(bags: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const bag of bags) {
    if (!bag.targetCode || seen.has(bag.bagNumber)) continue
    seen.add(bag.bagNumber)
    out.push(bag)
  }
  return out
}
