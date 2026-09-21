/**
 * 出仓派签达成分析 · 供应商综合排名：与 vendorAnalysis 的 rankVendors 是姊妹实现，
 * 但指标目录不同（本页独有的 5 个率类字段），且权重支持任意数值覆盖（不只是开关默认权重）。
 * 前后端共用唯一实现（shared/）。
 */
import {
  MIN_EFFECTIVE_WEIGHT_RATIO,
  MIN_RATE_SAMPLE,
  scoreBefore11,
  scoreDispatch24h,
  ticketsToBefore11Green,
  ticketsToDispatch24hGreen,
} from '../vendorAnalysis/rankingScore'

export const DISPATCH_RANKING_METRIC_KEYS = [
  'dispatch.priorityNextDaySign',
  'dispatch.sign24h',
  'dispatch.before11Exit',
  'dispatch.nextDaySign',
  'dispatch.sameDayExit',
] as const

export type DispatchRankingMetricKey = (typeof DISPATCH_RANKING_METRIC_KEYS)[number]

/** 默认权重：优先件次日完成率目前业务侧重最高；两条官方考核线次之；两项相关参考指标最低（合计 1） */
export const DEFAULT_DISPATCH_RANKING_WEIGHTS: Record<DispatchRankingMetricKey, number> = {
  'dispatch.priorityNextDaySign': 0.3,
  'dispatch.sign24h': 0.25,
  'dispatch.before11Exit': 0.2,
  'dispatch.nextDaySign': 0.15,
  'dispatch.sameDayExit': 0.1,
}

export const DISPATCH_RANKING_METRIC_LABELS_ZH: Record<DispatchRankingMetricKey, string> = {
  'dispatch.priorityNextDaySign': '优先件次日完成率',
  'dispatch.sign24h': '24H派签达成率',
  'dispatch.before11Exit': '11点前出仓率',
  'dispatch.nextDaySign': '次日派签达成率',
  'dispatch.sameDayExit': '当天出仓率',
}

/** 优先件量天然小，样本门槛比全量的 MIN_RATE_SAMPLE(30) 低 */
const MIN_PRIORITY_SAMPLE = 10

export type DispatchRankingInput = {
  supplierKey: string
  vendorCode: string
  supplierName: string
  /** 0–1；null = 未结算或无数据，该项不参与加权 */
  before11ExitRate: number | null
  before11ExitMet: number | null
  before11Total: number | null
  sameDayExitRate: number | null
  sameDayExitMet: number | null
  sameDayExitTotal: number | null
  signRate24h: number | null
  signMet24h: number | null
  signTotal24h: number | null
  nextDaySignRate: number | null
  nextDaySignMet: number | null
  nextDaySignTotal: number | null
  priorityNextDaySignRate: number | null
  priorityNextDaySignMet: number | null
  priorityTotal: number | null
  /** 不计入评分，仅供排行榜展示 */
  vendorProfit: number
}

export type DispatchMetricBreakdown = {
  key: DispatchRankingMetricKey
  label: string
  /** 重归一化后的有效权重；未纳入时为 0 */
  weight: number
  /** 0–100；未纳入时为 null */
  score: number | null
  included: boolean
  insufficientSample: boolean
  rawValue: number | null
  ticketsToGreen: number | null
}

export type DispatchRankingResult = {
  supplierKey: string
  vendorCode: string
  supplierName: string
  vendorProfit: number
  score: number
  rank: number
  poolSize: number
  sampleInsufficient: boolean
  breakdown: DispatchMetricBreakdown[]
}

export type DispatchRankingPoolResult = {
  rankings: DispatchRankingResult[]
  byKey: Map<string, DispatchRankingResult>
  poolSize: number
  poolMedianScore: number | null
  topScore: number | null
  bottomScore: number | null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** 两条曲线族：出仓类复用 scoreBefore11（99/95/90），派签类复用 scoreDispatch24h（95/92/85） */
const CURVE_FAMILY: Record<DispatchRankingMetricKey, 'exit' | 'sign'> = {
  'dispatch.before11Exit': 'exit',
  'dispatch.sameDayExit': 'exit',
  'dispatch.sign24h': 'sign',
  'dispatch.nextDaySign': 'sign',
  'dispatch.priorityNextDaySign': 'sign',
}

function metricTriple(
  key: DispatchRankingMetricKey,
  v: DispatchRankingInput,
): { rate: number | null; met: number | null; total: number | null; minSample: number } {
  switch (key) {
    case 'dispatch.before11Exit':
      return { rate: v.before11ExitRate, met: v.before11ExitMet, total: v.before11Total, minSample: MIN_RATE_SAMPLE }
    case 'dispatch.sameDayExit':
      return { rate: v.sameDayExitRate, met: v.sameDayExitMet, total: v.sameDayExitTotal, minSample: MIN_RATE_SAMPLE }
    case 'dispatch.sign24h':
      return { rate: v.signRate24h, met: v.signMet24h, total: v.signTotal24h, minSample: MIN_RATE_SAMPLE }
    case 'dispatch.nextDaySign':
      return { rate: v.nextDaySignRate, met: v.nextDaySignMet, total: v.nextDaySignTotal, minSample: MIN_RATE_SAMPLE }
    case 'dispatch.priorityNextDaySign':
      return {
        rate: v.priorityNextDaySignRate,
        met: v.priorityNextDaySignMet,
        total: v.priorityTotal,
        minSample: MIN_PRIORITY_SAMPLE,
      }
  }
}

type PartialScore = {
  key: DispatchRankingMetricKey
  baseWeight: number
  score: number | null
  included: boolean
  insufficientSample: boolean
  rawValue: number | null
  ticketsToGreen: number | null
}

function scoreOneMetric(
  key: DispatchRankingMetricKey,
  v: DispatchRankingInput,
  weights: Record<DispatchRankingMetricKey, number>,
): PartialScore {
  const baseWeight = weights[key] ?? 0
  const { rate, met, total, minSample } = metricTriple(key, v)
  const curve = CURVE_FAMILY[key]
  const ticketsToGreen =
    curve === 'exit' ? ticketsToBefore11Green(met, total) : ticketsToDispatch24hGreen(met, total)

  if (baseWeight <= 0) {
    return { key, baseWeight: 0, score: null, included: false, insufficientSample: false, rawValue: rate, ticketsToGreen }
  }
  if (rate == null || total == null) {
    return { key, baseWeight, score: null, included: false, insufficientSample: false, rawValue: rate, ticketsToGreen }
  }
  if (total < minSample) {
    return { key, baseWeight, score: null, included: false, insufficientSample: true, rawValue: rate, ticketsToGreen }
  }
  const score = curve === 'exit' ? scoreBefore11(rate) : scoreDispatch24h(rate)
  return { key, baseWeight, score, included: true, insufficientSample: false, rawValue: rate, ticketsToGreen }
}

/**
 * 在站点内供应商池计算综合排名。
 * @param weights 未传 → 用默认权重；传入时须是 5 项的完整权重表，单位与 DEFAULT_DISPATCH_RANKING_WEIGHTS
 *   一致（相对比例，函数内部按传入这组数字的总和归一化，不要求调用方自己先除以 100）。
 *   某项设为 0 = 该项从排名里剔除，权重按比例转移给其余项。
 */
export function rankDispatchSuppliers(
  vendors: DispatchRankingInput[],
  weights: Record<DispatchRankingMetricKey, number> = DEFAULT_DISPATCH_RANKING_WEIGHTS,
): DispatchRankingPoolResult {
  const poolSize = vendors.length
  if (poolSize === 0) {
    return { rankings: [], byKey: new Map(), poolSize: 0, poolMedianScore: null, topScore: null, bottomScore: null }
  }

  const totalWeight = DISPATCH_RANKING_METRIC_KEYS.reduce((s, k) => s + Math.max(0, weights[k] ?? 0), 0)

  type Scored = {
    supplierKey: string
    vendorCode: string
    supplierName: string
    vendorProfit: number
    partials: PartialScore[]
    score: number
    sampleInsufficient: boolean
  }

  const scored: Scored[] = vendors.map((v) => {
    const partials = DISPATCH_RANKING_METRIC_KEYS.map((key) => scoreOneMetric(key, v, weights))
    const included = partials.filter((p) => p.included && p.score != null)
    const weightSum = included.reduce((s, p) => s + p.baseWeight, 0)
    let score = 0
    if (weightSum > 0) {
      for (const p of included) score += (p.baseWeight / weightSum) * (p.score as number)
    }
    return {
      supplierKey: v.supplierKey,
      vendorCode: v.vendorCode,
      supplierName: v.supplierName,
      vendorProfit: v.vendorProfit,
      partials,
      score: round1(score),
      sampleInsufficient: totalWeight <= 0 || weightSum / totalWeight < MIN_EFFECTIVE_WEIGHT_RATIO,
    }
  })

  const priorityScore = (s: Scored) =>
    s.partials.find((p) => p.key === 'dispatch.priorityNextDaySign')?.score ?? -1
  const signScore = (s: Scored) => s.partials.find((p) => p.key === 'dispatch.sign24h')?.score ?? -1
  const before11Score = (s: Scored) =>
    s.partials.find((p) => p.key === 'dispatch.before11Exit')?.score ?? -1

  scored.sort((a, b) => {
    if (a.sampleInsufficient !== b.sampleInsufficient) return a.sampleInsufficient ? 1 : -1
    if (b.score !== a.score) return b.score - a.score
    if (priorityScore(b) !== priorityScore(a)) return priorityScore(b) - priorityScore(a)
    if (signScore(b) !== signScore(a)) return signScore(b) - signScore(a)
    if (before11Score(b) !== before11Score(a)) return before11Score(b) - before11Score(a)
    return a.supplierKey.localeCompare(b.supplierKey)
  })

  const rankings: DispatchRankingResult[] = scored.map((s, idx) => {
    const rank = idx + 1
    const includedWeightSum = s.partials
      .filter((p) => p.included && p.score != null)
      .reduce((sum, p) => sum + p.baseWeight, 0)

    const breakdown: DispatchMetricBreakdown[] = s.partials.map((p) => {
      const effectiveWeight =
        p.included && p.score != null && includedWeightSum > 0 ? p.baseWeight / includedWeightSum : 0
      return {
        key: p.key,
        label: DISPATCH_RANKING_METRIC_LABELS_ZH[p.key],
        weight: round1(effectiveWeight * 100) / 100,
        score: p.score == null ? null : round1(p.score),
        included: p.included,
        insufficientSample: p.insufficientSample,
        rawValue: p.rawValue,
        ticketsToGreen: p.ticketsToGreen,
      }
    })

    return {
      supplierKey: s.supplierKey,
      vendorCode: s.vendorCode,
      supplierName: s.supplierName,
      vendorProfit: s.vendorProfit,
      score: s.score,
      rank,
      poolSize,
      sampleInsufficient: s.sampleInsufficient,
      breakdown,
    }
  })

  const validScores = rankings.filter((r) => !r.sampleInsufficient).map((r) => r.score)
  const scoreAsc = [...validScores].sort((a, b) => a - b)

  return {
    rankings,
    byKey: new Map(rankings.map((r) => [r.supplierKey, r])),
    poolSize,
    poolMedianScore: median(scoreAsc),
    topScore: rankings[0]?.score ?? null,
    bottomScore: rankings[rankings.length - 1]?.score ?? null,
  }
}
