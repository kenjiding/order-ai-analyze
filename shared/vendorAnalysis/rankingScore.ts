/**
 * 供应商综合排名：供应商级 KPI → 0–100 分项分 → 专业权重加权。
 * 前后端共用唯一实现（shared/），调用方直接构造 VendorRankingInput，无兼容层。
 */

export const RANKING_METRIC_KEYS = [
  'vendor.complaintRate',
  'vendor.dispatch24h',
  'vendor.before11ExitRate',
  'vendor.unprocessedTickets',
  'vendor.longTail',
] as const

export type RankingMetricKey = (typeof RANKING_METRIC_KEYS)[number]

/** 默认权重：客诉与履约优先，过程指标次之（合计 1） */
export const DEFAULT_RANKING_WEIGHTS: Record<RankingMetricKey, number> = {
  'vendor.complaintRate': 0.28,
  'vendor.dispatch24h': 0.27,
  'vendor.before11ExitRate': 0.2,
  'vendor.unprocessedTickets': 0.15,
  'vendor.longTail': 0.1,
}

export const RANKING_METRIC_LABELS_ZH: Record<RankingMetricKey, string> = {
  'vendor.complaintRate': '客诉率',
  'vendor.dispatch24h': '24H派签率',
  'vendor.before11ExitRate': '11点前出仓率',
  'vendor.unprocessedTickets': '未处理工单',
  'vendor.longTail': '长尾单',
}

const MIN_RATE_SAMPLE = 30
const MIN_COMPLAINT_WAYBILLS = 500
/** 有效分项权重和低于此值 → 样本不足，名次排在有效样本之后 */
const MIN_EFFECTIVE_WEIGHT_RATIO = 0.5

export type VendorRankingInput = {
  vendorCode: string
  complaintRate: number
  complaintCount: number
  waybillCount: number
  unprocessedTicketCount: number
  longTailCount: number
  before11ExitRate: number | null
  before11ExitVolume: number | null
  before11TotalReceived: number | null
  /** 0–1；无数据时 null */
  dispatchRate24h: number | null
  dispatch24hTotal: number | null
  dispatch24hCount: number | null
}

export type MetricBreakdown = {
  key: RankingMetricKey
  label: string
  /** 重归一化后的有效权重；未纳入时为 0 */
  weight: number
  /** 0–100；未纳入时 null */
  score: number | null
  included: boolean
  insufficientSample: boolean
  /** 率类为 0–1；件数类为绝对件数 */
  rawValue: number | null
  /** 距绿线还差票数（越高越好的率）；客诉为「需再少 N 件」；件数类为 null */
  ticketsToGreen: number | null
}

export type VendorRankingResult = {
  vendorCode: string
  score: number
  rank: number
  poolSize: number
  sampleInsufficient: boolean
  breakdown: MetricBreakdown[]
}

export type RankingPoolResult = {
  rankings: VendorRankingResult[]
  byVendorCode: Map<string, VendorRankingResult>
  poolSize: number
  poolMedianScore: number | null
  topScore: number | null
  bottomScore: number | null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 由达标量/总量得到 0–1 派签率 */
export function dispatchRateFromTotals(
  count: number | null,
  total: number | null,
): number | null {
  if (count == null || total == null || total <= 0) return null
  return count / total
}

/** 体量基数：客诉窗口运单量与日均到件/派件取大，避免大供应商被绝对件数误伤 */
export function volumeBase(v: VendorRankingInput): number {
  return Math.max(v.waybillCount, v.before11TotalReceived ?? 0, v.dispatch24hTotal ?? 0, 1)
}

export function densityPerThousand(count: number, volume: number): number {
  return (count / Math.max(volume, 1)) * 1000
}

/** 件数密度 → 0–100（件/千票） */
export function scoreDensity(density: number): number {
  if (density <= 0) return 100
  if (density <= 1) return 85
  if (density <= 3) return 70
  if (density <= 6) return 50
  if (density <= 10) return 30
  return Math.max(0, 30 - 2 * (density - 10))
}

/** 11 点前出仓率（0–1）→ 0–100 */
export function scoreBefore11(rate: number): number {
  const pct = rate * 100
  if (pct >= 99) return 100
  if (pct >= 95) return 70 + (30 * (pct - 95)) / 4
  if (pct >= 90) return 40 + (30 * (pct - 90)) / 5
  return Math.max(0, (40 * pct) / 90)
}

/** 24H 派签率（0–1）→ 0–100 */
export function scoreDispatch24h(rate: number): number {
  const pct = rate * 100
  if (pct >= 95) return 100
  if (pct >= 92) return 70 + (30 * (pct - 92)) / 3
  if (pct >= 85) return 40 + (30 * (pct - 85)) / 7
  return Math.max(0, (40 * pct) / 85)
}

/** 客诉率（小数，如 0.00025 = 0.025%）→ 0–100 */
export function scoreComplaintRate(rate: number): number {
  if (rate <= 0.00025) return 100
  if (rate <= 0.0003) return 70 - (30 * (rate - 0.00025)) / 0.00005
  if (rate <= 0.0006) return 40 - (30 * (rate - 0.0003)) / 0.0003
  const capped = Math.min(rate, 0.001)
  return Math.max(0, (40 * (0.001 - capped)) / 0.0004)
}

export function ticketsToBefore11Green(
  exitVolume: number | null,
  totalReceived: number | null,
): number | null {
  if (exitVolume == null || totalReceived == null || totalReceived <= 0) return null
  const need = Math.ceil(0.99 * totalReceived)
  return Math.max(0, need - exitVolume)
}

export function ticketsToDispatch24hGreen(met: number | null, total: number | null): number | null {
  if (met == null || total == null || total <= 0) return null
  const need = Math.ceil(0.95 * total)
  return Math.max(0, need - met)
}

/** 客诉：相对绿线（≤0.025%）多出的件数 */
export function complaintsOverGreen(complaintCount: number, waybillCount: number): number | null {
  if (waybillCount <= 0) return null
  const maxAllowed = Math.floor(0.00025 * waybillCount + 1e-9)
  return Math.max(0, complaintCount - maxAllowed)
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

type PartialScore = {
  key: RankingMetricKey
  baseWeight: number
  score: number | null
  included: boolean
  insufficientSample: boolean
  rawValue: number | null
  ticketsToGreen: number | null
}

function scoreOneMetric(
  key: RankingMetricKey,
  v: VendorRankingInput,
  enabled: ReadonlySet<string> | undefined,
): PartialScore {
  const baseWeight = DEFAULT_RANKING_WEIGHTS[key]
  if (enabled && !enabled.has(key)) {
    return {
      key,
      baseWeight,
      score: null,
      included: false,
      insufficientSample: false,
      rawValue: null,
      ticketsToGreen: null,
    }
  }

  if (key === 'vendor.before11ExitRate') {
    const total = v.before11TotalReceived
    const rate = v.before11ExitRate
    if (rate == null || total == null) {
      return {
        key,
        baseWeight,
        score: null,
        included: false,
        insufficientSample: false,
        rawValue: null,
        ticketsToGreen: null,
      }
    }
    if (total < MIN_RATE_SAMPLE) {
      return {
        key,
        baseWeight,
        score: null,
        included: false,
        insufficientSample: true,
        rawValue: rate,
        ticketsToGreen: ticketsToBefore11Green(v.before11ExitVolume, total),
      }
    }
    return {
      key,
      baseWeight,
      score: scoreBefore11(rate),
      included: true,
      insufficientSample: false,
      rawValue: rate,
      ticketsToGreen: ticketsToBefore11Green(v.before11ExitVolume, total),
    }
  }

  if (key === 'vendor.dispatch24h') {
    const total = v.dispatch24hTotal
    const rate = v.dispatchRate24h
    if (rate == null || total == null) {
      return {
        key,
        baseWeight,
        score: null,
        included: false,
        insufficientSample: false,
        rawValue: null,
        ticketsToGreen: null,
      }
    }
    if (total < MIN_RATE_SAMPLE) {
      return {
        key,
        baseWeight,
        score: null,
        included: false,
        insufficientSample: true,
        rawValue: rate,
        ticketsToGreen: ticketsToDispatch24hGreen(v.dispatch24hCount, total),
      }
    }
    return {
      key,
      baseWeight,
      score: scoreDispatch24h(rate),
      included: true,
      insufficientSample: false,
      rawValue: rate,
      ticketsToGreen: ticketsToDispatch24hGreen(v.dispatch24hCount, total),
    }
  }

  if (key === 'vendor.complaintRate') {
    if (v.waybillCount < MIN_COMPLAINT_WAYBILLS) {
      return {
        key,
        baseWeight,
        score: null,
        included: false,
        insufficientSample: true,
        rawValue: v.complaintRate,
        ticketsToGreen: complaintsOverGreen(v.complaintCount, v.waybillCount),
      }
    }
    return {
      key,
      baseWeight,
      score: scoreComplaintRate(v.complaintRate),
      included: true,
      insufficientSample: false,
      rawValue: v.complaintRate,
      ticketsToGreen: complaintsOverGreen(v.complaintCount, v.waybillCount),
    }
  }

  const count = key === 'vendor.unprocessedTickets' ? v.unprocessedTicketCount : v.longTailCount
  return {
    key,
    baseWeight,
    score: scoreDensity(densityPerThousand(count, volumeBase(v))),
    included: true,
    insufficientSample: false,
    rawValue: count,
    ticketsToGreen: null,
  }
}

/**
 * 在勾选供应商池内计算综合排名。
 * @param enabledMetricKeys 未传 → 五项全开；传入则只对启用的供应商级指标加权并重归一化
 */
export function rankVendors(
  vendors: VendorRankingInput[],
  enabledMetricKeys?: ReadonlySet<string>,
): RankingPoolResult {
  const poolSize = vendors.length
  if (poolSize === 0) {
    return {
      rankings: [],
      byVendorCode: new Map(),
      poolSize: 0,
      poolMedianScore: null,
      topScore: null,
      bottomScore: null,
    }
  }

  type Scored = {
    vendorCode: string
    partials: PartialScore[]
    score: number
    sampleInsufficient: boolean
  }

  const scored: Scored[] = vendors.map((v) => {
    const partials = RANKING_METRIC_KEYS.map((key) => scoreOneMetric(key, v, enabledMetricKeys))
    const included = partials.filter((p) => p.included && p.score != null)
    const weightSum = included.reduce((s, p) => s + p.baseWeight, 0)
    let score = 0
    if (weightSum > 0) {
      for (const p of included) {
        score += (p.baseWeight / weightSum) * (p.score as number)
      }
    }
    return {
      vendorCode: v.vendorCode,
      partials,
      score: round1(score),
      sampleInsufficient: weightSum < MIN_EFFECTIVE_WEIGHT_RATIO,
    }
  })

  const complaintScore = (s: Scored) =>
    s.partials.find((p) => p.key === 'vendor.complaintRate')?.score ?? -1
  const dispatchScore = (s: Scored) =>
    s.partials.find((p) => p.key === 'vendor.dispatch24h')?.score ?? -1
  const before11Score = (s: Scored) =>
    s.partials.find((p) => p.key === 'vendor.before11ExitRate')?.score ?? -1

  scored.sort((a, b) => {
    if (a.sampleInsufficient !== b.sampleInsufficient) return a.sampleInsufficient ? 1 : -1
    if (b.score !== a.score) return b.score - a.score
    if (complaintScore(b) !== complaintScore(a)) return complaintScore(b) - complaintScore(a)
    if (dispatchScore(b) !== dispatchScore(a)) return dispatchScore(b) - dispatchScore(a)
    if (before11Score(b) !== before11Score(a)) return before11Score(b) - before11Score(a)
    return a.vendorCode.localeCompare(b.vendorCode)
  })

  const rankings: VendorRankingResult[] = scored.map((s, idx) => {
    const rank = idx + 1
    const includedWeightSum = s.partials
      .filter((p) => p.included && p.score != null)
      .reduce((sum, p) => sum + p.baseWeight, 0)

    const breakdown: MetricBreakdown[] = s.partials.map((p) => {
      const effectiveWeight =
        p.included && p.score != null && includedWeightSum > 0
          ? p.baseWeight / includedWeightSum
          : 0
      return {
        key: p.key,
        label: RANKING_METRIC_LABELS_ZH[p.key],
        weight: round1(effectiveWeight * 100) / 100,
        score: p.score == null ? null : round1(p.score),
        included: p.included,
        insufficientSample: p.insufficientSample,
        rawValue: p.rawValue,
        ticketsToGreen: p.ticketsToGreen,
      }
    })

    return {
      vendorCode: s.vendorCode,
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
    byVendorCode: new Map(rankings.map((r) => [r.vendorCode, r])),
    poolSize,
    poolMedianScore: median(scoreAsc),
    topScore: rankings[0]?.score ?? null,
    bottomScore: rankings[rankings.length - 1]?.score ?? null,
  }
}
